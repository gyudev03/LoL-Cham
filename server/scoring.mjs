// 챔피언 숙련도 점수 계산 (서버를 켜지 않고도 테스트할 수 있도록 index.mjs와 분리)
//
// 100점 = 성과 지표 90점(라인별 카테고리) + 보정 승률 10점
//  - 판수는 점수에 가산하지 않는다. 표본이 15판보다 적을 때만 점수를 50점 쪽으로 끌어당겨 과신을 막는다.
//  - 데이터에 없는 지표는 제외하고 남은 지표로 90점을 다시 나눈다.
//  - 기준 범위(low~high)는 이 앱이 정한 고정값이다. 티어 평균과 비교한 값이 아니다. low > high이면 낮을수록 좋은 지표다.

export const MIN_GAMES = 5            // 이 판수 미만이면 점수를 매기지 않는다
export const FULL_TRUST_GAMES = 15    // 이 판수부터 점수를 100% 반영한다
const PERFORMANCE_POINTS = 90
const WIN_RATE_POINTS = 10
const WIN_RATE_RANGE = [35, 65]       // 보정 승률 기준 범위(%)
const WIN_RATE_PRIOR_GAMES = 10       // 승률을 50% 쪽으로 당기는 강도(가상 10판)
const MIN_VALUE_GAMES = 3             // 지표 값이 이만큼의 경기에서 확인돼야 사용
const MIN_VALUE_COVERAGE = 0.5        // 그리고 전체 경기의 절반 이상에서 값이 있어야 사용
const TONE_GOOD = 70
const TONE_WARN = 40

export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
export function scoreBetween(value, low, high) { return clamp(((value - low) / (high - low)) * 100, 0, 100) }
const round1 = (value) => Math.round(value * 10) / 10
const finite = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const minutesOf = (participant) => Math.max((finite(participant.timePlayed) ?? 0) / 60, 1)

// 오브젝트 관여율: 그 판에서 처치된 드래곤·전령·바론 전체(양 팀 합) 중, 내가 개입해서 얻은 비율(%).
// 상대에게 내준 오브젝트도 분모에 들어가므로, 합류가 늦거나 내주는 일이 많으면 낮아진다.
// Riot challenges는 값이 0이면 필드가 빠지는 경우가 있어, challenges 자체가 있는 경기에서는 빠진 필드를 0으로 본다.
const TAKEDOWN_KEYS = ['dragonTakedowns', 'baronTakedowns', 'riftHeraldTakedowns']
const hasChallenges = (participant) => finite(participant.challenges?.goldPerMinute) !== null || finite(participant.challenges?.damagePerMinute) !== null
const hasTakedownField = (participant) => TAKEDOWN_KEYS.some((key) => finite(participant.challenges?.[key]) !== null)
function objectiveShare(participant, info) {
  if (!hasChallenges(participant)) return null
  const mine = TAKEDOWN_KEYS.reduce((sum, key) => sum + (finite(participant.challenges[key]) ?? 0), 0)
  const total = (info?.teams || []).reduce((sum, team) => sum + ['dragon', 'baron', 'riftHerald'].reduce((inner, key) => inner + (finite(team.objectives?.[key]?.kills) ?? 0), 0), 0)
  if (total <= 0) return null
  return clamp((mine / total) * 100, 0, 100)
}

function killParticipation(participant, info) {
  const direct = finite(participant.challenges?.killParticipation)
  if (direct !== null) return direct * 100
  const team = (info?.teams || []).find((item) => item.teamId === participant.teamId)
  const teamKills = finite(team?.objectives?.champion?.kills)
  if (teamKills && teamKills > 0 && finite(participant.kills) !== null && finite(participant.assists) !== null) return clamp(((participant.kills + participant.assists) / teamKills) * 100, 0, 100)
  return null
}

// 측정 항목: 경기 1판에서 값을 뽑는 방법과 표시 문구
export const MEASURES = {
  csPerMinute: {
    subject: '분당 CS', unit: '', digits: 1,
    extract: (p) => ((finite(p.totalMinionsKilled) ?? 0) + (finite(p.neutralMinionsKilled) ?? 0)) / minutesOf(p),
    strong: '라인 수급이 안정적입니다.', weak: '낮은 편입니다. 막타 연습과 웨이브 관리를 점검해 보세요.',
  },
  goldPerMinute: {
    subject: '분당 골드', unit: '', digits: 0,
    extract: (p) => finite(p.challenges?.goldPerMinute) ?? (finite(p.goldEarned) !== null ? p.goldEarned / minutesOf(p) : null),
    strong: '성장 속도가 빠릅니다.', weak: '낮은 편입니다. 초반 CS와 오브젝트 참여로 성장 속도를 높여 보세요.',
  },
  earlyCs: {
    subject: '10분 전 CS', unit: '개', digits: 0,
    extract: (p) => finite(p.challenges?.laneMinionsFirst10Minutes),
    strong: '초반 라인전 CS가 안정적입니다.', weak: '낮은 편입니다. 첫 10분 막타에 집중해 보세요.',
  },
  jungleCs10: {
    subject: '10분 전 정글 CS', unit: '개', digits: 1,
    extract: (p) => finite(p.challenges?.jungleCsBefore10Minutes),
    strong: '초반 동선이 안정적입니다.', weak: '낮은 편입니다. 첫 클리어 동선과 캠프 리젠 타이밍을 점검해 보세요.',
  },
  damagePerMinute: {
    subject: '분당 피해량', unit: '', digits: 0,
    extract: (p) => finite(p.challenges?.damagePerMinute) ?? (finite(p.totalDamageDealtToChampions) !== null ? p.totalDamageDealtToChampions / minutesOf(p) : null),
    strong: '교전 기여가 높습니다.', weak: '낮은 편입니다. 교전에서 딜을 넣을 수 있는 위치를 점검해 보세요.',
  },
  // 받은 피해를 '데스당'으로 보면, 의미 없이 죽어서 받은 피해가 많아지는 경우에는 오히려 값이 낮아진다.
  damageTakenPerDeath: {
    subject: '데스당 받은 피해', unit: '', digits: 0,
    extract: (p) => (finite(p.totalDamageTaken) !== null && finite(p.deaths) !== null ? p.totalDamageTaken / (p.deaths + 1) : null),
    strong: '맞은 피해에 비해 잘 살아남습니다.', weak: '낮은 편입니다. 앞라인에서 버티는 시간과 이탈 판단을 점검해 보세요.',
  },
  deathsPerGame: {
    subject: '판당 데스', unit: '', digits: 1,
    extract: (p) => finite(p.deaths),
    strong: '죽음이 적어 안정적으로 플레이합니다.', weak: '데스가 잦은 편입니다. 무리한 교전과 진입 타이밍을 복기해 보세요.',
  },
  killParticipation: {
    subject: '킬 관여율', unit: '%', digits: 0,
    extract: killParticipation,
    strong: '팀 교전에 꾸준히 참여합니다.', weak: '낮은 편입니다. 오브젝트와 교전 타이밍에 합류하는 횟수를 늘려 보세요.',
  },
  visionPerMinute: {
    subject: '분당 시야 점수', unit: '', digits: 1,
    extract: (p) => finite(p.challenges?.visionScorePerMinute) ?? (finite(p.visionScore) !== null ? p.visionScore / minutesOf(p) : null),
    strong: '시야 장악이 좋습니다.', weak: '낮은 편입니다. 오브젝트 전 와드 설치와 제거를 늘려 보세요.',
  },
  controlWards: {
    subject: '경기당 제어 와드', unit: '개', digits: 1,
    extract: (p) => finite(p.visionWardsBoughtInGame),
    strong: '제어 와드를 꾸준히 구매합니다.', weak: '적은 편입니다. 귀환할 때마다 1개씩 구매해 보세요.',
  },
  objectiveShare: {
    subject: '오브젝트 관여율', unit: '%', digits: 0,
    extract: objectiveShare,
    supported: (games) => games.some((game) => hasTakedownField(game.participant)),
    strong: '게임 전체 오브젝트에 꾸준히 개입합니다.', weak: '낮은 편입니다. 합류가 늦거나 상대에게 내주는 오브젝트가 많습니다. 드래곤·전령 타이밍에 맞춰 이동해 보세요.',
  },
}

// 지표: weight는 카테고리 안에서의 비율. options가 둘 이상이면 점수가 높은 쪽을 채택한다(탑·정글 전투).
const m = (id, low, high, weight = 1) => ({ weight, options: [{ id, low, high }] })
// 탑·정글 전투: 피해량과 '데스당 받은 피해' 중 높은 쪽을 쓴다
const FRONTLINE = (dpmLow, dpmHigh) => ({ label: '전투 기여', weight: 1, options: [{ id: 'damagePerMinute', low: dpmLow, high: dpmHigh }, { id: 'damageTakenPerDeath', low: 3000, high: 9000 }] })
const growth = (points, cs, gold, early) => ({ label: '성장', points, metrics: [m('csPerMinute', ...cs, .4), m('goldPerMinute', ...gold, .3), m('earlyCs', ...early, .3)] })
// 기준값 보정 근거: 한국 서버 계정 3개의 라인별 평균(챌린저 13위 약 1,000판 / 프로게이머 약 550판 / 플래티넘 2 약 520판)
//  - high(만점 기준) = 챌린저·프로 평균 수준, low(0점 기준) = 플래티넘 평균보다 한참 아래.
//    그 결과 플래티넘 2는 대략 60점대, 챌린저·프로는 80점대 중반 이상이 되도록 맞췄다.
//  - 데스는 판당으로 센다(약 29분 기준 플래티넘 5.8 · 챌린저 5.5 · 프로 4.6). 9판당 이상이면 0점, 4 이하면 만점.
//  - 오브젝트 관여율은 '양 팀이 처치한 전체 오브젝트 중 내가 개입한 비율'. 정글 랭커 708판(승률 52%)의 평균이 53%라서, 만점 기준을 60%로 두어 여유를 남겼다.
//  - 정글 랭커 708판 실측: 10분 전 정글 CS 68.2, 골드 460, 분당 피해량 735, 판당 데스 4.9, 킬 관여율 60% → 각 지표가 76~97%에 오도록 확인했다.
//  - 정글·서폿·탑은 표본이 적어(12~68판) 잠정값이다. 다른 계정 데이터가 쌓이면 다시 맞춘다.
const DEATHS = m('deathsPerGame', 9, 4)

export const LANE_RULES = {
  TOP: [
    growth(30, [5, 8.5], [320, 450], [50, 85]),
    { label: '전투', points: 35, metrics: [FRONTLINE(400, 900)] },
    { label: '생존', points: 25, metrics: [DEATHS] },
  ],
  JUNGLE: [
    { label: '오브젝트', points: 20, metrics: [m('objectiveShare', 20, 60)] },
    { label: '성장', points: 15, metrics: [m('jungleCs10', 45, 72, .5), m('goldPerMinute', 300, 480, .5)] },
    { label: '전투', points: 15, metrics: [FRONTLINE(300, 750)] },
    { label: '생존', points: 15, metrics: [DEATHS] },
    { label: '팀 기여', points: 25, metrics: [m('killParticipation', 30, 70)] },
  ],
  MID: [
    growth(25, [5.5, 9], [350, 450], [55, 90]),
    { label: '전투', points: 25, metrics: [m('damagePerMinute', 500, 900)] },
    { label: '생존', points: 20, metrics: [DEATHS] },
    { label: '팀 기여', points: 20, metrics: [m('killParticipation', 25, 55)] },
  ],
  BOTTOM: [
    growth(25, [6, 9], [380, 520], [50, 78]),
    { label: '전투', points: 35, metrics: [m('damagePerMinute', 500, 900)] },
    { label: '생존', points: 30, metrics: [DEATHS] },
  ],
  SUPPORT: [
    { label: '시야', points: 35, metrics: [m('visionPerMinute', 1.5, 3.3, .7), m('controlWards', 2, 10, .3)] },
    { label: '팀 기여', points: 30, metrics: [m('killParticipation', 35, 70)] },
    { label: '생존', points: 25, metrics: [DEATHS] },
  ],
}

function formatValue(measure, value) { return `${value.toFixed(measure.digits)}${measure.unit}` }

// 한 옵션의 평균값. 값이 충분한 경기에서 확인되지 않으면 null.
export function measureOption(option, games) {
  const measure = MEASURES[option.id]
  if (measure.supported && !measure.supported(games)) return null
  const values = games.map((game) => finite(measure.extract(game.participant, game.info))).filter((value) => value !== null)
  if (values.length < MIN_VALUE_GAMES || values.length / games.length < MIN_VALUE_COVERAGE) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { option, measure, mean, score: scoreBetween(mean, option.low, option.high), shown: formatValue(measure, mean) }
}

export function evaluateChampion(lane, games) {
  const count = games.length
  const wins = games.filter((game) => game.participant.win).length
  const winRate = Math.round((wins / count) * 1000) / 10
  const rules = LANE_RULES[lane] || LANE_RULES.MID

  // 1) 지표 측정
  const categories = rules.map((category) => {
    const metrics = category.metrics.map((metric) => {
      const results = metric.options.map((option) => measureOption(option, games)).filter(Boolean)
      const label = metric.label || MEASURES[metric.options[0].id].subject
      if (!results.length) return { metric, label, available: false }
      const chosen = results.reduce((best, item) => (item.score > best.score ? item : best))
      const detail = results.length > 1
        ? `${results.map((item) => `${item.measure.subject} ${item.shown}`).join(' / ')} → ${chosen.measure.subject} 기준`
        : `${chosen.measure.subject} ${chosen.shown} (기준 ${formatValue(chosen.measure, chosen.option.low)}~${formatValue(chosen.measure, chosen.option.high)})`
      return { metric, label, available: true, chosen, score: chosen.score, detail }
    })
    return { category, metrics }
  })

  // 2) 데이터가 없는 지표는 제외하고 비중을 다시 나눈다
  const active = categories.filter((item) => item.metrics.some((metric) => metric.available))
  const activePoints = active.reduce((sum, item) => sum + item.category.points, 0)
  const scale = activePoints ? PERFORMANCE_POINTS / activePoints : 0
  const excluded = categories.flatMap((item) => item.metrics.filter((metric) => !metric.available).map((metric) => metric.label))
  const rows = []
  for (const item of active) {
    const weightSum = item.metrics.filter((metric) => metric.available).reduce((sum, metric) => sum + metric.metric.weight, 0)
    for (const metric of item.metrics) {
      if (!metric.available) continue
      const max = item.category.points * scale * (metric.metric.weight / weightSum)
      const tone = metric.score >= TONE_GOOD ? 'good' : metric.score >= TONE_WARN ? 'neutral' : 'warn'
      rows.push({ ...metric, category: item.category.label, max, points: (metric.score / 100) * max, tone })
    }
  }

  // 3) 보정 승률: 표본이 적을수록 50%에 가깝게 본다
  const adjustedWinRate = ((wins + WIN_RATE_PRIOR_GAMES * 0.5) / (count + WIN_RATE_PRIOR_GAMES)) * 100
  const winPoints = (scoreBetween(adjustedWinRate, WIN_RATE_RANGE[0], WIN_RATE_RANGE[1]) * WIN_RATE_POINTS) / 100

  // 4) 합산과 표본 보정
  const rawScore = Math.round(rows.reduce((sum, row) => sum + row.points, 0) + winPoints)
  const trust = Math.min(1, count / FULL_TRUST_GAMES)
  const aiScore = count < MIN_GAMES || !rows.length ? null : Math.round(50 + (rawScore - 50) * trust)

  const strengths = rows.filter((row) => row.tone === 'good').sort((a, b) => b.score - a.score).slice(0, 3)
    .map((row) => `${row.chosen.measure.subject} ${row.chosen.shown} — ${row.chosen.measure.strong}`)
  const improvements = rows.filter((row) => row.tone === 'warn').sort((a, b) => a.score - b.score).slice(0, 3)
    .map((row) => `${row.chosen.measure.subject} ${row.chosen.shown} — ${row.chosen.measure.weak}`)
  if (count >= 10 && winRate >= 55) strengths.push(`${count}판 승률 ${winRate}% — 결과도 좋습니다.`)
  if (count >= 10 && winRate <= 45) improvements.push(`${count}판 승률 ${winRate}% — 패배 경기에서 반복되는 원인을 복기해 보세요.`)
  if (aiScore !== null && !strengths.length) strengths.push('기준을 넘긴 강점 지표는 아직 없습니다.')
  if (aiScore !== null && !improvements.length) improvements.push('보완이 필요한 지표는 없습니다.')

  return {
    aiScore,
    rawScore: aiScore === null ? null : rawScore,
    metrics: rows.map((row) => ({ label: row.label, tone: row.tone, detail: row.detail, value: row.tone === 'good' ? '상' : row.tone === 'neutral' ? '보통' : '보완 필요' })),
    scoreBreakdown: aiScore === null ? undefined : [
      ...rows.map((row) => ({ label: `${row.category} · ${row.label}`, points: round1(row.points), max: round1(row.max), detail: row.detail })),
      { label: '승률(보정)', points: round1(winPoints), max: WIN_RATE_POINTS, detail: `${count}판 ${winRate}% → 보정 ${round1(adjustedWinRate)}% (기준 ${WIN_RATE_RANGE[0]}%~${WIN_RATE_RANGE[1]}%)` },
    ],
    strengths: aiScore === null ? ['분석을 위한 최소 5게임이 필요합니다.'] : strengths,
    improvements: aiScore === null ? ['게임 수가 쌓이면 개선할 점을 알려드립니다.'] : improvements,
    analysisNote: aiScore !== null && trust < 1 ? `표본이 ${count}판이라 점수를 ${Math.round(trust * 100)}%만 반영했습니다 (원점수 ${rawScore}). ${FULL_TRUST_GAMES}판부터 그대로 반영됩니다.` : undefined,
    scoreNote: aiScore !== null && excluded.length ? `데이터가 없어 제외한 지표: ${[...new Set(excluded)].join(', ')}. 남은 지표로 90점을 다시 나눠 계산했습니다.` : undefined,
  }
}

// 적합도: 같은 라인의 '다른 챔피언들' 평균 원점수와의 차이. 비교 기준이 되는 게임이 10판 미만이면 null.
export function computeFit(entries) {
  const result = new Map()
  const scored = entries.filter((entry) => entry.rawScore !== null && entry.rawScore !== undefined)
  for (const entry of scored) {
    const others = scored.filter((other) => other.lane === entry.lane && other.key !== entry.key)
    const games = others.reduce((sum, other) => sum + other.count, 0)
    if (games < 10) continue
    const baseline = others.reduce((sum, other) => sum + other.rawScore * other.count, 0) / games
    result.set(entry.key, { delta: Math.round(entry.rawScore - baseline), baseline: Math.round(baseline), games })
  }
  return result
}
