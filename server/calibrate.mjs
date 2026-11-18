// 사용법: node calibrate.mjs [puuid]     (server 폴더에서 실행. puuid를 생략하면 캐시의 모든 사용자를 출력)
// 캐시된 경기에서 라인별 '내 평균 지표값'과 현재 기준표(low~high), 그 지표의 점수를 보여준다. 기준값을 실제 데이터로 맞출 때 사용한다.
import { evaluateChampion, LANE_RULES, MEASURES, measureOption } from './scoring.mjs'
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
const LANE = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'BOTTOM', UTILITY: 'SUPPORT' }
const only = process.argv[2]

for (const [puuid, player] of Object.entries(cache.players || {})) {
  if (only && puuid !== only) continue
  const byLane = {}
  for (const match of Object.values(player.matches || {})) {
    const participant = match?.info?.participants?.find((item) => item.puuid === puuid)
    const lane = participant && (LANE[participant.teamPosition] || LANE[participant.individualPosition])
    if (lane) (byLane[lane] ??= []).push({ participant, info: match.info, createdAt: match.info.gameCreation })
  }
  console.log(`\n######## ${puuid.slice(0, 12)}…  (${player.account?.gameName ?? player.summary?.profile?.name ?? '이름 미확인'})`)
  for (const [lane, games] of Object.entries(byLane)) {
    const wins = games.filter((game) => game.participant.win).length
    console.log(`\n[${lane}] ${games.length}판 · 승률 ${Math.round((wins / games.length) * 100)}%`)
    for (const category of LANE_RULES[lane]) {
      for (const metric of category.metrics) {
        for (const option of metric.options) {
          const result = measureOption(option, games)
          const range = `${option.low}~${option.high}`
          console.log(`  ${category.label.padEnd(5)} ${(metric.label || option.id).padEnd(10)} 내 평균 ${result ? result.shown.padStart(8) : '   (없음)'}   현재 기준 ${range.padEnd(12)} → ${result ? `${Math.round(result.score)}%` : '제외'}`)
        }
      }
    }
    // 참고(점수 미반영): 계산식이 맞는지 점검하기 위한 값. 예) 정글이 아닌 라인의 오브젝트 참여율이 비정상적으로 높으면 계산식을 의심한다.
    const reference = ['objectiveShare', 'killParticipation'].map((id) => { const r = measureOption({ id, low: 0, high: 100 }, games); return r ? `${MEASURES[id].subject} ${r.shown}` : null }).filter(Boolean)
    const avg = (key) => (games.reduce((sum, game) => sum + (game.participant[key] || 0), 0) / games.length).toFixed(1)
    console.log(`  (참고) ${reference.join(' · ')} · 평균 K/D/A ${avg('kills')}/${avg('deaths')}/${avg('assists')}`)
    const byChampion = {}
    for (const game of games) (byChampion[game.participant.championId] ??= []).push(game)
    const rows = Object.entries(byChampion).filter(([, list]) => list.length >= 5).map(([id, list]) => ({ id, n: list.length, r: evaluateChampion(lane, list) }))
    rows.sort((a, b) => b.n - a.n)
    console.log('  챔피언별(5판 이상): ' + (rows.map((row) => `#${row.id} ${row.n}판 점수${row.r.aiScore}(원${row.r.rawScore})`).join(' · ') || '없음'))
  }
}
