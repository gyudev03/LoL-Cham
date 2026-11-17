// 사용법: node inspect-fields.mjs   (server 폴더에서 실행)
// 서버 캐시의 내 경기들에서 점수 계산에 쓰는 필드가 실제로 얼마나 들어 있는지 보여준다.
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 서버는 'DATA_DIR 환경변수' 또는 '서버를 실행한 폴더/data'에 캐시를 만든다. 가능한 위치를 차례로 찾는다.
async function findCache() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [process.env.DATA_DIR, path.join(process.cwd(), 'data'), path.join(process.cwd(), '..', 'data'), path.join(here, 'data'), path.join(here, '..', 'data')]
    .filter(Boolean).map((dir) => path.join(path.resolve(dir), 'riot-season-cache.json'))
  for (const file of candidates) { try { await access(file); return file } catch { /* 다음 후보 */ } }
  console.error('riot-season-cache.json을 찾지 못했습니다. 찾아본 위치:\n  ' + [...new Set(candidates)].join('\n  '))
  console.error('\n서버를 켠 상태에서 앱에서 해당 사용자를 동기화(데이터 새로고침)하면, 서버를 실행한 폴더 아래 data 폴더에 생깁니다.')
  console.error('다른 위치에 있다면 DATA_DIR을 지정하세요. 예) PowerShell: $env:DATA_DIR="C:\\Code\\LoL-Cham\\data"; node calibrate.mjs')
  process.exit(1)
}
const CACHE_FILE = await findCache()
console.log('캐시 파일:', CACHE_FILE)
const cache = JSON.parse(await readFile(CACHE_FILE, 'utf8'))

const rows = []
for (const [puuid, player] of Object.entries(cache.players || {})) {
  for (const match of Object.values(player.matches || {})) {
    const participant = match?.info?.participants?.find((item) => item.puuid === puuid)
    if (participant) rows.push({ participant, info: match.info })
  }
}
if (!rows.length) { console.log('캐시에 경기가 없습니다. 먼저 앱에서 데이터를 동기화하세요.'); process.exit(0) }

const num = (value) => typeof value === 'number' && Number.isFinite(value)
const pct = (count) => `${Math.round((count / rows.length) * 100)}%`
const used = {
  'deaths': (r) => r.participant.deaths, 'timePlayed': (r) => r.participant.timePlayed,
  'totalDamageTaken': (r) => r.participant.totalDamageTaken, 'totalDamageDealtToChampions': (r) => r.participant.totalDamageDealtToChampions,
  'totalMinionsKilled': (r) => r.participant.totalMinionsKilled, 'goldEarned': (r) => r.participant.goldEarned,
  'visionWardsBoughtInGame': (r) => r.participant.visionWardsBoughtInGame,
  'challenges.damagePerMinute': (r) => r.participant.challenges?.damagePerMinute, 'challenges.goldPerMinute': (r) => r.participant.challenges?.goldPerMinute,
  'challenges.killParticipation': (r) => r.participant.challenges?.killParticipation, 'challenges.visionScorePerMinute': (r) => r.participant.challenges?.visionScorePerMinute,
  'challenges.jungleCsBefore10Minutes': (r) => r.participant.challenges?.jungleCsBefore10Minutes,
  'challenges.laneMinionsFirst10Minutes (초반 CS)': (r) => r.participant.challenges?.laneMinionsFirst10Minutes,
  'challenges.*Takedowns 중 하나라도 있음 (없으면 오브젝트 지표 제외)': (r) => ['dragonTakedowns', 'baronTakedowns', 'riftHeraldTakedowns'].some((key) => num(r.participant.challenges?.[key])) ? 1 : null,
  'info.teams[].objectives.dragon.kills': (r) => r.info.teams?.[0]?.objectives?.dragon?.kills,
}
console.log(`내 경기 ${rows.length}판 기준 — 점수 계산에 쓰는 필드의 존재 비율\n`)
for (const [name, get] of Object.entries(used)) console.log(`${pct(rows.filter((row) => num(get(row))).length).padStart(5)}  ${name}`)

const keys = {}
for (const row of rows) for (const [key, value] of Object.entries(row.participant.challenges || {})) if (num(value)) keys[key] = (keys[key] || 0) + 1
const interesting = Object.keys(keys).filter((key) => /advantage|lane|early|solo|takedown|objective|turret|damageTaken|vision/i.test(key)).sort()
console.log(`\n참고: challenges 안의 관련 후보 필드 ${interesting.length}개 (15분 골드·경험치 격차 등 추가 지표 후보)`)
for (const key of interesting) console.log(`${pct(keys[key]).padStart(5)}  challenges.${key}`)
