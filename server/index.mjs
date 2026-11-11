import 'dotenv/config'
import cors from 'cors'
import express from 'express'

const app = express()
const PORT = Number(process.env.PORT || 8787)
const API_KEY = process.env.RIOT_API_KEY
const KR = 'https://kr.api.riotgames.com'
const ASIA = 'https://asia.api.riotgames.com'
const DDRAGON = 'https://ddragon.leagueoflegends.com'
let championCatalogPromise

app.use(cors({ origin: 'http://localhost:5173' }))

class RiotApiError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

async function riotFetch(url) {
  if (!API_KEY) throw new RiotApiError(503, 'RIOT_API_KEY가 설정되지 않았습니다. .env 파일을 만든 후 API 키를 입력하세요.')
  const response = await fetch(url, { headers: { 'X-Riot-Token': API_KEY } })
  if (!response.ok) {
    const messages = { 400: 'Riot ID 또는 태그 형식이 올바르지 않습니다.', 401: 'Riot API 키가 유효하지 않습니다.', 403: 'Riot API 접근이 거부되었습니다.', 404: '해당 Riot 계정을 찾을 수 없습니다.', 429: 'Riot API 요청 한도에 도달했습니다. 잠시 뒤 다시 시도하세요.' }
    throw new RiotApiError(response.status, messages[response.status] || `Riot API 오류 (${response.status})`)
  }
  return response.json()
}

async function getChampionCatalog() {
  if (!championCatalogPromise) championCatalogPromise = (async () => {
    const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json())
    const version = versions[0]
    const payload = await fetch(`${DDRAGON}/cdn/${version}/data/ko_KR/champion.json`).then((r) => r.json())
    const byKey = new Map(Object.values(payload.data).map((champion) => [Number(champion.key), champion]))
    return { version, byKey }
  })()
  return championCatalogPromise
}

const laneByTeamPosition = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'BOTTOM', UTILITY: 'SUPPORT' }
const laneLabel = { TOP: '탑', JUNGLE: '정글', MID: '미드', BOTTOM: '원딜', SUPPORT: '서포터' }

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function daysAgo(timestamp) { return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000)) }
function lastPlayedLabel(timestamp) { const days = daysAgo(timestamp); return days === 0 ? '오늘' : `${days}일 전` }
function asPercent(value) { return Math.round(value * 10) / 10 }
async function mapWithConcurrency(values, limit, callback) {
  const result = []
  for (let index = 0; index < values.length; index += limit) {
    const batch = values.slice(index, index + limit)
    result.push(...await Promise.all(batch.map(callback)))
    if (index + limit < values.length) await new Promise((resolve) => setTimeout(resolve, 220))
  }
  return result
}

function buildChampionStats(matches, masteries, catalog) {
  const byChampion = new Map()
  for (const match of matches) {
    const participant = match.info.participants.find((item) => item.puuid === match.metadata.participants.find((puuid) => puuid === item.puuid))
    if (!participant) continue
    const lane = laneByTeamPosition[participant.teamPosition]
    if (!lane) continue
    const current = byChampion.get(participant.championId) || { championId: participant.championId, lane, games: [], wins: 0 }
    current.games.push({ participant, createdAt: match.info.gameCreation })
    current.wins += participant.win ? 1 : 0
    byChampion.set(participant.championId, current)
  }

  const masteryById = new Map(masteries.map((mastery) => [mastery.championId, mastery]))
  return [...byChampion.values()].map((entry) => {
    const catalogItem = catalog.byKey.get(entry.championId)
    if (!catalogItem) return null
    const games = entry.games.sort((a, b) => b.createdAt - a.createdAt)
    const count = games.length
    const winRate = asPercent((entry.wins / count) * 100)
    const avg = (key) => games.reduce((total, game) => total + (game.participant[key] || 0), 0) / count
    const avgKda = (avg('kills') + avg('assists')) / Math.max(avg('deaths'), 1)
    const avgCs = (avg('totalMinionsKilled') + avg('neutralMinionsKilled')) / Math.max(games.reduce((total, game) => total + game.participant.timePlayed, 0) / count / 60, 1)
    const avgVision = avg('visionScore')
    const roleRaw = entry.lane === 'SUPPORT' ? (avgVision * 1.6 + avgKda * 8) : entry.lane === 'JUNGLE' ? (avgKda * 11 + avgCs * 7) : (avgKda * 10 + avgCs * 9)
    const roleScore = clamp(roleRaw, 0, 100)
    const frequency = clamp(count / 12, 0, 1) * 15
    const sample = clamp(count / 20, 0, 1) * 10
    const aiScore = count < 5 ? null : Math.round(roleScore * .5 + winRate * .2 + frequency + sample + 2.5)
    const mastery = masteryById.get(entry.championId)
    const metrics = entry.lane === 'SUPPORT'
      ? [{ label: '시야 관리', value: avgVision >= 45 ? '상' : avgVision >= 28 ? '보통' : '보완 필요', tone: avgVision >= 45 ? 'good' : avgVision >= 28 ? 'neutral' : 'warn' }, { label: '교전 기여', value: avgKda >= 3 ? '양호' : '보완 필요', tone: avgKda >= 3 ? 'good' : 'warn' }]
      : [{ label: '전투 기여', value: avgKda >= 3 ? '상' : avgKda >= 2 ? '보통' : '보완 필요', tone: avgKda >= 3 ? 'good' : avgKda >= 2 ? 'neutral' : 'warn' }, { label: 'CS 수급', value: avgCs >= 6.5 ? '양호' : '보완 필요', tone: avgCs >= 6.5 ? 'good' : 'warn' }]
    return {
      id: catalogItem.id, name: catalogItem.name, lane: entry.lane,
      image: `${DDRAGON}/cdn/${catalog.version}/img/champion/${catalogItem.image.full}`,
      tier: '—', mastery: mastery?.championPoints || 0, masteryLevel: mastery?.championLevel || 0,
      aiScore, winRate, games: count, lastPlayed: lastPlayedLabel(games[0].createdAt), runes: ['외부 데이터 연동 준비 중'],
      counters: { good: ['연동 준비 중'], difficult: ['연동 준비 중'] },
      strengths: aiScore === null ? ['분석을 위한 게임 수가 부족합니다.'] : [winRate >= 55 ? '최근 승률이 안정적입니다.' : '최근 게임 데이터를 기반으로 분석했습니다.'],
      improvements: [count < 10 ? '플레이 표본이 적어 신뢰도가 낮습니다.' : metrics.find((metric) => metric.tone === 'warn') ? '역할별 핵심 지표를 보완해 보세요.' : '현재 지표가 안정적으로 유지되고 있습니다.'],
      metrics,
    }
  }).filter(Boolean)
}

app.get('/api/health', (_request, response) => response.json({ configured: Boolean(API_KEY) }))

app.get('/api/riot/sync', async (request, response) => {
  const gameName = String(request.query.gameName || '').trim()
  const tagLine = String(request.query.tagLine || '').trim()
  if (!gameName || !tagLine) return response.status(400).json({ message: 'Riot ID와 태그를 모두 입력하세요.' })
  try {
    const account = await riotFetch(`${ASIA}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`)
    const [masteries, leagueEntries, soloMatchIds, flexMatchIds, catalog] = await Promise.all([
      riotFetch(`${KR}/lol/champion-mastery/v4/champion-masteries/by-puuid/${account.puuid}`),
      riotFetch(`${KR}/lol/league/v4/entries/by-puuid/${account.puuid}`),
      riotFetch(`${ASIA}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=420&start=0&count=30`),
      riotFetch(`${ASIA}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=440&start=0&count=30`),
      getChampionCatalog(),
    ])
    const matchIds = [...new Set([...soloMatchIds, ...flexMatchIds])]
    const matchResponses = await mapWithConcurrency(matchIds, 4, (matchId) => riotFetch(`${ASIA}/lol/match/v5/matches/${matchId}`).catch(() => null))
    const matches = matchResponses.filter(Boolean).filter((match) => [420, 440].includes(match.info.queueId))
      .filter((match) => match.info.participants.some((participant) => participant.puuid === account.puuid))
      .sort((a, b) => b.info.gameCreation - a.info.gameCreation).slice(0, 30)
    const ownedMatches = matches.map((match) => ({ ...match, metadata: { ...match.metadata, participants: [account.puuid] } }))
    const championStats = buildChampionStats(ownedMatches, masteries, catalog)
    const ranked = leagueEntries.find((entry) => entry.queueType === 'RANKED_SOLO_5x5') || leagueEntries.find((entry) => entry.queueType === 'RANKED_FLEX_SR')
    response.json({ account: { puuid: account.puuid, gameName: account.gameName, tagLine: account.tagLine, rank: ranked ? `${ranked.tier} ${ranked.rank} ${ranked.leaguePoints}LP` : '랭크 정보 없음' }, champions: championStats, syncedAt: new Date().toISOString(), matchCount: matches.length })
  } catch (error) {
    response.status(error.status || 500).json({ message: error.message || '데이터를 동기화하지 못했습니다.' })
  }
})

app.listen(PORT, () => console.log(`Riot API server listening on http://localhost:${PORT}`))
