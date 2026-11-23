// 한 사용자의 여러 Riot 아이디를 합친 '모든 아이디 통합' 통계에 쓰는 계산 모음.
// 서버를 켜지 않고도 테스트할 수 있도록 index.mjs와 분리했다.

export const AGGREGATE_PUUID = 'aggregate'

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']
const DIVISION_ORDER = { IV: 0, III: 1, II: 2, I: 3 }

// 'EMERALD II 45LP' 같은 문자열을 비교 가능한 숫자로 바꾼다. 읽을 수 없으면 null.
function rankValue(rank) {
  const match = /^([A-Z]+)\s+(IV|III|II|I)\s+(\d+)LP$/.exec(String(rank ?? '').trim())
  if (!match || !TIER_ORDER.includes(match[1])) return null
  return TIER_ORDER.indexOf(match[1]) * 1_000_000 + DIVISION_ORDER[match[2]] * 100_000 + Number(match[3])
}

// 여러 계정의 랭크 중 가장 높은 것. 하나도 읽지 못하면 '랭크 정보 없음'.
export function bestRank(ranks) {
  let best = null
  for (const rank of ranks) {
    const value = rankValue(rank)
    if (value !== null && (best === null || value > best.value)) best = { value, rank }
  }
  return best ? best.rank : '랭크 정보 없음'
}

// 계정별 분석 결과에서 챔피언 공식 숙련도를 합친다. 점수는 합산, 레벨은 가장 높은 값.
// 같은 챔피언을 여러 라인에서 했어도 숙련도는 챔피언 단위라서 한 번만 센다.
export function mergeMasteries(summaries, idToKey) {
  const merged = new Map()
  for (const summary of summaries) {
    const perAccount = new Map()
    for (const champion of summary?.champions ?? []) if (!perAccount.has(champion.id)) perAccount.set(champion.id, champion)
    for (const [id, champion] of perAccount) {
      const key = idToKey.get(id)
      if (key === undefined) continue
      const current = merged.get(key) ?? { championId: key, championPoints: 0, championLevel: 0 }
      current.championPoints += champion.mastery || 0
      current.championLevel = Math.max(current.championLevel, champion.masteryLevel || 0)
      merged.set(key, current)
    }
  }
  return [...merged.values()]
}

// 한 계정의 저장된 경기에서 분석 대상(솔로·자유랭크, 그 계정이 참가한 경기)을 고른다.
export function ownedMatchesOf(player, puuid) {
  return Object.values(player?.matches ?? {}).filter(Boolean)
    .filter((match) => [420, 440].includes(match.info?.queueId))
    .filter((match) => match.info.participants?.some((participant) => participant.puuid === puuid))
    .map((match) => ({ ...match, metadata: { ...match.metadata, participants: [puuid] } }))
}

export function countWins(matches) {
  return matches.filter((match) => match.info.participants.find((participant) => participant.puuid === match.metadata.participants[0])?.win).length
}
