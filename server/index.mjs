import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const app = express()
const PORT = Number(process.env.PORT || 8787)
const API_KEY = process.env.RIOT_API_KEY
const KR = 'https://kr.api.riotgames.com'
const ASIA = 'https://asia.api.riotgames.com'
const DDRAGON = 'https://ddragon.leagueoflegends.com'
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), 'data')
const CACHE_PATH = path.join(DATA_DIR, 'riot-season-cache.json')
const USERS_PATH = path.join(DATA_DIR, 'users.json')
const DIST_DIR = path.join(process.cwd(), 'dist')
const APP_USERNAME = process.env.APP_USERNAME || 'chamlog'
const APP_PASSWORD = process.env.APP_PASSWORD || ''
const RIOT_REQUEST_INTERVAL_MS = 1250
let championCatalogPromise
let cacheWriteChain = Promise.resolve()
let nextRiotRequestAt = 0
const syncJobs = new Map()

app.use(cors({ origin: 'http://localhost:5173' }))
app.get('/api/health', (_request, response) => response.json({ configured: Boolean(API_KEY) }))

if (process.env.NODE_ENV === 'production' && !APP_PASSWORD) {
  throw new Error('APP_PASSWORD must be set in production.')
}

function sameSecret(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function requireAppAccess(request, response, next) {
  if (!APP_PASSWORD) return next()
  const [scheme, encodedCredentials] = (request.get('authorization') || '').split(' ')
  if (scheme === 'Basic' && encodedCredentials) {
    const credentials = Buffer.from(encodedCredentials, 'base64').toString('utf8')
    const separator = credentials.indexOf(':')
    const username = separator >= 0 ? credentials.slice(0, separator) : ''
    const password = separator >= 0 ? credentials.slice(separator + 1) : ''
    if (sameSecret(username, APP_USERNAME) && sameSecret(password, APP_PASSWORD)) return next()
  }
  response.set('WWW-Authenticate', 'Basic realm="Chamlog"')
  return response.status(401).send('Chamlog access authentication is required.')
}

app.use(requireAppAccess)
app.use(express.json())

class RiotApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function riotFetch(url) {
  if (!API_KEY) throw new RiotApiError(503, 'RIOT_API_KEY가 설정되지 않았습니다. .env 파일을 만든 후 API 키를 입력하세요.')
  const wait = Math.max(0, nextRiotRequestAt - Date.now())
  nextRiotRequestAt = Math.max(Date.now(), nextRiotRequestAt) + RIOT_REQUEST_INTERVAL_MS
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
  const response = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } })
  if (!response.ok) {
    const messages = { 400: 'Riot ID 또는 태그 형식이 올바르지 않습니다.', 401: 'Riot API 키가 유효하지 않습니다.', 403: 'Riot API 접근이 거부되었습니다.', 404: '해당 Riot 계정을 찾을 수 없습니다.', 429: 'Riot API 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.' }
    throw new RiotApiError(response.status, messages[response.status] || `Riot API 오류 (${response.status})`)
  }
  return response.json()
}

async function loadCache() {
  try { return JSON.parse(await readFile(CACHE_PATH, 'utf8')) } catch { return { players: {} } }
}

async function loadUsers() {
  try { return JSON.parse(await readFile(USERS_PATH, 'utf8')) } catch { return null }
}

function saveCache(cache) {
  cacheWriteChain = cacheWriteChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const temporaryPath = `${CACHE_PATH}.tmp`
    await writeFile(temporaryPath, JSON.stringify(cache), 'utf8')
    await rename(temporaryPath, CACHE_PATH)
  })
  return cacheWriteChain
}

function saveUsers(users) {
  cacheWriteChain = cacheWriteChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true })
    const temporaryPath = `${USERS_PATH}.tmp`
    await writeFile(temporaryPath, JSON.stringify(users, null, 2), 'utf8')
    await rename(temporaryPath, USERS_PATH)
  })
  return cacheWriteChain
}

function createJob() {
  const id = crypto.randomUUID()
  const job = { id, status: 'queued', message: '동기화 대기 중', fetched: 0, total: 0, result: null, error: null, cancelled: false, startedAt: new Date().toISOString(), completedAt: null }
  syncJobs.set(id, job)
  return job
}

function jobResponse(job) {
  return { id: job.id, status: job.status, message: job.message, fetched: job.fetched, total: job.total, result: job.result, error: job.error, startedAt: job.startedAt, completedAt: job.completedAt }
}

function ensureNotCancelled(job) {
  if (job.cancelled) throw new RiotApiError(499, '동기화가 취소되었습니다.')
}

async function getChampionCatalog() {
  if (!championCatalogPromise) championCatalogPromise = (async () => {
    const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json())
    const version = versions[0]
    const [payload, runeTrees] = await Promise.all([
      fetch(`${DDRAGON}/cdn/${version}/data/ko_KR/champion.json`).then((r) => r.json()),
      fetch(`${DDRAGON}/cdn/${version}/data/ko_KR/runesReforged.json`).then((r) => r.json()),
    ])
    const byKey = new Map(Object.values(payload.data).map((champion) => [Number(champion.key), champion]))
    const runeById = new Map()
    for (const tree of runeTrees) {
      runeById.set(tree.id, tree.name)
      for (const slot of tree.slots) for (const rune of slot.runes) runeById.set(rune.id, rune.name)
    }
    return { version, byKey, runeById }
  })()
  return championCatalogPromise
}

const laneByTeamPosition = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'BOTTOM', UTILITY: 'SUPPORT' }
const laneLabel = { TOP: '탑', JUNGLE: '정글', MID: '미드', BOTTOM: '원딜', SUPPORT: '서포터' }

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function scoreBetween(value, low, high) { return clamp(((value - low) / (high - low)) * 100, 0, 100) }
function daysAgo(timestamp) { return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000)) }
function lastPlayedLabel(timestamp) { const days = daysAgo(timestamp); return days === 0 ? '오늘' : `${days}일 전` }
function asPercent(value) { return Math.round(value * 10) / 10 }
function seasonStartSeconds() {
  const configured = process.env.SEASON_START
  const year = new Date().getFullYear()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(configured || '') ? `${configured}T00:00:00+09:00` : `${year}-01-08T12:00:00+09:00`
  return Math.floor(new Date(date).getTime() / 1000)
}
const statShardById = {
  5001: '체력', 5002: '이동 속도', 5003: '체력 증가', 5005: '공격 속도',
  5007: '스킬 가속', 5008: '적응형 능력치', 5010: '강인함·둔화 저항', 5011: '체력 증가',
}

function participantRuneConfiguration(participant, runeById) {
  const styles = participant.perks?.styles || []
  const primary = styles.find((style) => style.description === 'primaryStyle') || styles[0]
  const secondary = styles.find((style) => style.description === 'subStyle') || styles.find((style) => style !== primary)
  if (!primary) return null
  const names = (style) => (style?.selections || []).map((selection) => runeById.get(selection.perk)).filter(Boolean)
  const statPerks = participant.perks?.statPerks || {}
  return {
    primaryTree: runeById.get(primary.style) || '주 룬',
    primaryRunes: names(primary),
    secondaryTree: secondary ? runeById.get(secondary.style) || '보조 룬' : null,
    secondaryRunes: names(secondary),
    shards: [statPerks.offense, statPerks.flex, statPerks.defense].map((id) => statShardById[id]).filter(Boolean),
    key: [primary.style, ...(primary.selections || []).map((selection) => selection.perk), secondary?.style || '', ...(secondary?.selections || []).map((selection) => selection.perk), statPerks.offense || '', statPerks.flex || '', statPerks.defense || ''].join('|'),
  }
}

function mostPlayedRunes(games, runeById) {
  const configurations = new Map()
  for (const game of games) {
    const configuration = participantRuneConfiguration(game.participant, runeById)
    if (!configuration) continue
    const current = configurations.get(configuration.key) || { ...configuration, games: 0, wins: 0 }
    current.games += 1
    if (game.participant.win) current.wins += 1
    configurations.set(configuration.key, current)
  }
  const mostPlayed = [...configurations.values()].sort((a, b) => b.games - a.games || b.wins - a.wins)[0]
  if (!mostPlayed) return null
  return {
    primaryTree: mostPlayed.primaryTree,
    primaryRunes: mostPlayed.primaryRunes,
    secondaryTree: mostPlayed.secondaryTree,
    secondaryRunes: mostPlayed.secondaryRunes,
    shards: mostPlayed.shards,
    games: mostPlayed.games,
    pickRate: Math.round((mostPlayed.games / games.length) * 100),
    winRate: Math.round((mostPlayed.wins / mostPlayed.games) * 100),
  }
}
function buildChampionStats(matches, masteries, catalog) {
  const byChampion = new Map()
  for (const match of matches) {
    const participant = match.info.participants.find((item) => item.puuid === match.metadata.participants.find((puuid) => puuid === item.puuid))
    if (!participant) continue
    // teamPosition이 NONE/빈 값이면 실제 개인 포지션을 보조 기준으로 사용한다.
    const lane = laneByTeamPosition[participant.teamPosition] || laneByTeamPosition[participant.individualPosition]
    if (!lane) continue
    const championLaneKey = `${participant.championId}:${lane}`
    const current = byChampion.get(championLaneKey) || { championId: participant.championId, lane, games: [], wins: 0 }
    current.games.push({ participant, createdAt: match.info.gameCreation })
    current.wins += participant.win ? 1 : 0
    byChampion.set(championLaneKey, current)
  }

  const masteryById = new Map(masteries.map((mastery) => [mastery.championId, mastery]))
  return [...byChampion.values()].map((entry) => {
    const catalogItem = catalog.byKey.get(entry.championId)
    if (!catalogItem) return null
    const games = entry.games.sort((a, b) => b.createdAt - a.createdAt)
    const count = games.length
    const winRate = asPercent((entry.wins / count) * 100)
    const avg = (key) => games.reduce((total, game) => total + (game.participant[key] || 0), 0) / count
    const avgChallenge = (key) => games.reduce((total, game) => total + (game.participant.challenges?.[key] || 0), 0) / count
    const averageMinutes = Math.max(games.reduce((total, game) => total + game.participant.timePlayed, 0) / count / 60, 1)
    const avgCsPerMinute = (avg('totalMinionsKilled') + avg('neutralMinionsKilled')) / averageMinutes
    const avgDamagePerMinute = avgChallenge('damagePerMinute')
    const avgGoldPerMinute = avgChallenge('goldPerMinute')
    const avgKillParticipation = avgChallenge('killParticipation') * 100
    const avgVisionPerMinute = avgChallenge('visionScorePerMinute') || avg('visionScore') / averageMinutes
    const avgControlWards = avg('visionWardsBoughtInGame')
    const avgJungleCsBefore10 = avgChallenge('jungleCsBefore10Minutes')

    let roleScore = 0
    let metrics = []
    if (entry.lane === 'JUNGLE') {
      const jungleFarmScore = scoreBetween(avgJungleCsBefore10, 10, 35)
      const participationScore = scoreBetween(avgKillParticipation, 30, 75)
      const combatScore = scoreBetween(avgDamagePerMinute, 250, 750)
      roleScore = jungleFarmScore * .35 + participationScore * .4 + combatScore * .25
      metrics = [
        { label: '초반 정글링', value: avgJungleCsBefore10 >= 25 ? '상' : avgJungleCsBefore10 >= 17 ? '보통' : '보완 필요', tone: avgJungleCsBefore10 >= 25 ? 'good' : avgJungleCsBefore10 >= 17 ? 'neutral' : 'warn' },
        { label: '킬 관여', value: avgKillParticipation >= 55 ? '상' : avgKillParticipation >= 40 ? '보통' : '보완 필요', tone: avgKillParticipation >= 55 ? 'good' : avgKillParticipation >= 40 ? 'neutral' : 'warn' },
        { label: '교전 기여', value: avgDamagePerMinute >= 500 ? '양호' : '보완 필요', tone: avgDamagePerMinute >= 500 ? 'good' : 'warn' },
      ]
    } else if (entry.lane === 'SUPPORT') {
      const visionScore = scoreBetween(avgVisionPerMinute, .6, 2.8)
      const participationScore = scoreBetween(avgKillParticipation, 35, 80)
      const wardScore = scoreBetween(avgControlWards, 2, 10)
      roleScore = visionScore * .45 + participationScore * .35 + wardScore * .2
      metrics = [
        { label: '시야 관리', value: avgVisionPerMinute >= 1.8 ? '상' : avgVisionPerMinute >= 1.1 ? '보통' : '보완 필요', tone: avgVisionPerMinute >= 1.8 ? 'good' : avgVisionPerMinute >= 1.1 ? 'neutral' : 'warn' },
        { label: '킬 관여', value: avgKillParticipation >= 60 ? '상' : avgKillParticipation >= 45 ? '보통' : '보완 필요', tone: avgKillParticipation >= 60 ? 'good' : avgKillParticipation >= 45 ? 'neutral' : 'warn' },
        { label: '제어 와드', value: avgControlWards >= 5 ? '양호' : '보완 필요', tone: avgControlWards >= 5 ? 'good' : 'warn' },
      ]
    } else {
      const csScore = scoreBetween(avgCsPerMinute, 4, 8)
      const goldScore = scoreBetween(avgGoldPerMinute, 260, 480)
      const combatScore = scoreBetween(avgDamagePerMinute, 280, 850)
      roleScore = csScore * .4 + goldScore * .3 + combatScore * .3
      metrics = [
        { label: 'CS 수급', value: avgCsPerMinute >= 6.5 ? '상' : avgCsPerMinute >= 5 ? '보통' : '보완 필요', tone: avgCsPerMinute >= 6.5 ? 'good' : avgCsPerMinute >= 5 ? 'neutral' : 'warn' },
        { label: '골드 수급', value: avgGoldPerMinute >= 390 ? '양호' : '보완 필요', tone: avgGoldPerMinute >= 390 ? 'good' : 'warn' },
        { label: '전투 기여', value: avgDamagePerMinute >= 500 ? '양호' : '보완 필요', tone: avgDamagePerMinute >= 500 ? 'good' : 'warn' },
      ]
    }
    const frequency = clamp(count / 12, 0, 1) * 15
    const sample = clamp(count / 20, 0, 1) * 10
    const aiScore = count < 5 ? null : Math.round(roleScore * .5 + winRate * .2 + frequency + sample + 2.5)
    const mastery = masteryById.get(entry.championId)
    return {
      id: catalogItem.id, entryId: `${catalogItem.id}:${entry.lane}`, name: catalogItem.name, lane: entry.lane,
      image: `${DDRAGON}/cdn/${catalog.version}/img/champion/${catalogItem.image.full}`,
      tier: '—', mastery: mastery?.championPoints || 0, masteryLevel: mastery?.championLevel || 0,
      aiScore, winRate, games: count, lastPlayed: lastPlayedLabel(games[0].createdAt),
      analysisNote: count >= 5 && count < 10 ? `이번 시즌 분석 게임이 ${count}판입니다. 게임 수가 적어 AI 숙련도 결과가 정확하지 않을 수 있습니다.` : undefined,
      runeInfo: mostPlayedRunes(games, catalog.runeById),
      counters: { good: ['연동 준비 중'], difficult: ['연동 준비 중'] },
      strengths: aiScore === null ? ['분석을 위한 최소 5게임이 필요합니다.'] : [winRate >= 55 ? '이번 시즌 승률이 안정적입니다.' : '이번 시즌 게임 데이터를 기반으로 분석했습니다.'],
      improvements: [count < 10 ? '플레이 표본이 적어 결과를 참고용으로 확인해 주세요.' : metrics.find((metric) => metric.tone === 'warn') ? '역할별 핵심 지표를 보완해 보세요.' : '현재 지표가 안정적으로 유지되고 있습니다.'],
      metrics,
    }
  }).filter(Boolean)
}

app.get('/api/users', async (_request, response) => {
  response.json({ users: await loadUsers() })
})

app.put('/api/users', async (request, response) => {
  const users = request.body?.users
  if (!Array.isArray(users) || users.length > 50) return response.status(400).json({ message: '사용자 목록 형식이 올바르지 않습니다.' })
  const lanes = new Set(['TOP', 'JUNGLE', 'MID', 'BOTTOM', 'SUPPORT'])
  const valid = users.every((user) => Number.isFinite(user.id) && typeof user.name === 'string' && user.name.trim() && typeof user.riotId === 'string' && user.riotId.trim() && typeof user.tag === 'string' && user.tag.trim() && lanes.has(user.lane) && typeof user.active === 'boolean')
  if (!valid) return response.status(400).json({ message: '사용자 정보에 필수 항목이 누락되었습니다.' })
  await saveUsers(users)
  response.json({ users })
})

async function collectSeasonMatchIds(puuid, startTime, job) {
  const ids = new Set()
  for (const queue of [420, 440]) {
    let start = 0
    while (true) {
      ensureNotCancelled(job)
      job.message = `${queue === 420 ? '솔로랭크' : '자유랭크'} 시즌 매치 목록을 확인하는 중 (${start}개 조회)`
      const page = await riotFetch(`${ASIA}/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${queue}&startTime=${startTime}&start=${start}&count=100`)
      page.forEach((matchId) => ids.add(matchId))
      if (page.length < 100) break
      start += 100
    }
  }
  return [...ids]
}

async function runSeasonSync(job, gameName, tagLine) {
  try {
    job.status = 'running'
    job.message = 'Riot 계정 정보를 확인하는 중'
    const account = await riotFetch(`${ASIA}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`)
    const startTime = seasonStartSeconds()
    const cache = await loadCache()
    const cachedPlayer = cache.players[account.puuid]
    const player = cachedPlayer?.seasonStart === startTime ? cachedPlayer : { seasonStart: startTime, matches: {} }
    cache.players[account.puuid] = player

    const [masteries, leagueEntries, catalog, matchIds] = await Promise.all([
      riotFetch(`${KR}/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}`),
      riotFetch(`${KR}/lol/league/v4/entries/by-puuid/${account.puuid}`),
      getChampionCatalog(),
      collectSeasonMatchIds(account.puuid, startTime, job),
    ])

    const missingIds = matchIds.filter((matchId) => !player.matches[matchId])
    job.total = missingIds.length
    job.fetched = 0
    if (!missingIds.length) job.message = '저장된 시즌 전적을 분석하는 중'
    for (const matchId of missingIds) {
      ensureNotCancelled(job)
      job.message = `시즌 게임 상세를 저장하는 중 (${job.fetched + 1}/${job.total})`
      const match = await riotFetch(`${ASIA}/lol/match/v5/matches/${matchId}`)
      player.matches[matchId] = match
      job.fetched += 1
      if (job.fetched % 20 === 0) await saveCache(cache)
    }
    await saveCache(cache)

    job.message = '이번 시즌 챔피언 데이터를 분석하는 중'
    const matches = matchIds.map((matchId) => player.matches[matchId]).filter(Boolean)
      .filter((match) => [420, 440].includes(match.info.queueId))
      .filter((match) => match.info.participants.some((participant) => participant.puuid === account.puuid))
      .sort((a, b) => b.info.gameCreation - a.info.gameCreation)
    const ownedMatches = matches.map((match) => ({ ...match, metadata: { ...match.metadata, participants: [account.puuid] } }))
    const championStats = buildChampionStats(ownedMatches, masteries, catalog)
    const ranked = leagueEntries.find((entry) => entry.queueType === 'RANKED_SOLO_5x5') || leagueEntries.find((entry) => entry.queueType === 'RANKED_FLEX_SR')
    job.result = {
      account: { puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, rank: ranked ? `${ranked.tier} ${ranked.rank} ${ranked.leaguePoints}LP` : '랭크 정보 없음' },
      champions: championStats,
      syncedAt: new Date().toISOString(),
      matchCount: matches.length,
      seasonStart: new Date(startTime * 1000).toISOString(),
    }
    player.summary = job.result
    await saveCache(cache)
    job.status = 'completed'
    job.message = `이번 시즌 랭크 게임 ${matches.length}판 분석 완료`
    job.completedAt = new Date().toISOString()
  } catch (error) {
    if (job.cancelled || error.status === 499) {
      job.status = 'cancelled'
      job.message = '동기화가 취소되었습니다. 저장된 게임은 다음 동기화 때 재사용됩니다.'
    } else {
      job.status = 'failed'
      job.error = error.message || '데이터를 동기화하지 못했습니다.'
      job.message = '동기화에 실패했습니다.'
    }
    job.completedAt = new Date().toISOString()
  }
}

app.post('/api/riot/sync', (request, response) => {
  const gameName = String(request.body?.gameName || '').trim()
  const tagLine = String(request.body?.tagLine || '').trim()
  if (!gameName || !tagLine) return response.status(400).json({ message: 'Riot ID와 태그를 모두 입력하세요.' })
  const job = createJob()
  void runSeasonSync(job, gameName, tagLine)
  response.status(202).json(jobResponse(job))
})

app.get('/api/riot/sync/:jobId', (request, response) => {
  const job = syncJobs.get(request.params.jobId)
  if (!job) return response.status(404).json({ message: '동기화 작업을 찾지 못했습니다.' })
  response.json(jobResponse(job))
})

app.get('/api/riot/summary/:puuid', async (request, response) => {
  const cache = await loadCache()
  const summary = cache.players?.[request.params.puuid]?.summary
  if (!summary) return response.status(404).json({ message: '저장된 분석 결과가 없습니다. 데이터 새로고침을 눌러 첫 동기화를 진행하세요.' })
  response.json(summary)
})

app.delete('/api/riot/sync/:jobId', (request, response) => {
  const job = syncJobs.get(request.params.jobId)
  if (!job) return response.status(404).json({ message: '동기화 작업을 찾지 못했습니다.' })
  if (job.status === 'queued' || job.status === 'running') {
    job.cancelled = true
    job.message = '현재 요청을 마친 뒤 동기화를 취소하는 중'
  }
  response.json(jobResponse(job))
})

app.use(express.static(DIST_DIR))
app.use((request, response) => {
  if (request.path.startsWith('/api/')) return response.status(404).json({ message: 'API 경로를 찾지 못했습니다.' })
  return response.sendFile(path.join(DIST_DIR, 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => console.log(`Chamlog server listening on port ${PORT}`))
