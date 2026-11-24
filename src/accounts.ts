// 한 사용자가 가진 여러 Riot 아이디를 다루는 순수 계산 모음 (화면·Firebase와 무관해서 단독으로 테스트할 수 있다).
// 대표 아이디는 사용자의 riotId/tag/puuid/syncedAt에, 나머지는 extraAccounts에 저장한다.
// 그래서 아이디가 하나뿐인 기존 데이터는 그대로 호환된다.

export type RiotAccount = { riotId: string; tag: string; puuid?: string; syncedAt?: string }
export type AccountRef = { index: number; riotId: string; tag: string; puuid?: string; syncedAt: Date }
// 'all' = 모든 아이디 통합, 숫자 = accountsOf(profile)의 위치 (0이 대표 아이디)
export type AccountSel = 'all' | number
export type AccountOwner = { riotId: string; tag: string; puuid?: string; syncedAt: Date; extraAccounts?: RiotAccount[] }

// '모든 아이디 통합' 결과에 쓰는 가짜 puuid. 일반 계정 데이터와 헷갈리지 않게 구분한다.
export const AGGREGATE_PUUID = 'aggregate'

export const normalizeRiotId = (value?: string) => (value ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
export const accountText = (account: { riotId: string; tag: string }) => `${account.riotId}#${account.tag}`
const sameAccount = (left: { riotId: string; tag: string }, right: { riotId: string; tag: string }) =>
  normalizeRiotId(left.riotId) === normalizeRiotId(right.riotId) && normalizeRiotId(left.tag) === normalizeRiotId(right.tag)

export function accountsOf(profile: AccountOwner): AccountRef[] {
  const extras = (profile.extraAccounts ?? []).map((item, offset) => ({
    index: offset + 1, riotId: item.riotId, tag: item.tag, puuid: item.puuid, syncedAt: item.syncedAt ? new Date(item.syncedAt) : new Date(0),
  }))
  return [{ index: 0, riotId: profile.riotId, tag: profile.tag, puuid: profile.puuid, syncedAt: profile.syncedAt }, ...extras]
}

// 사용자를 고르면 처음에는 대표 아이디(맨 위 아이디)를 보여준다. 통합은 아이디 드롭다운 맨 아래에서 고른다.
export const defaultSelection = (_profile: AccountOwner): AccountSel => 0

// 사용자가 아이디를 줄였거나 순서를 바꿔도 범위를 벗어난 선택이 남지 않도록 보정한다.
export function resolveSelection(requested: AccountSel, accountCount: number): AccountSel {
  if (requested === 'all') return accountCount > 1 ? 'all' : 0
  return requested >= 0 && requested < accountCount ? requested : 0
}

// 동기화 결과(아이디·태그·puuid·시각)를 해당 위치의 아이디에 반영한다.
export function withAccount<T extends AccountOwner>(profile: T, index: number, patch: { riotId: string; tag: string; puuid: string; syncedAt: Date }): T {
  if (index === 0) return { ...profile, ...patch }
  return {
    ...profile,
    extraAccounts: (profile.extraAccounts ?? []).map((item, offset) => offset === index - 1
      ? { riotId: patch.riotId, tag: patch.tag, puuid: patch.puuid, syncedAt: patch.syncedAt.toISOString() }
      : item),
  }
}

// '모든 아이디 통합' 시각: 가장 오래된 동기화 기준. 한 번도 동기화하지 않았으면 epoch.
export function oldestSync(accounts: AccountRef[]): Date {
  const times = accounts.map((item) => item.syncedAt.getTime()).filter((time) => time > 0)
  return new Date(times.length ? Math.min(...times) : 0)
}

// 사용자 수정 창에서 입력한 아이디 목록으로 대표/추가 아이디를 다시 만든다.
// 이미 동기화한 아이디(같은 Riot ID#태그)는 puuid와 동기화 시각을 그대로 유지하고, 새로 넣거나 바꾼 아이디는 비워 둔다.
// 같은 아이디를 두 번 넣으면 하나로 본다. 빈 칸은 무시하고, 아이디나 태그 중 하나만 채운 줄이 있으면 null을 돌려준다.
export function rebuildAccounts(previous: AccountRef[], entered: { riotId: string; tag: string }[]) {
  const rows = entered.map((item) => ({ riotId: item.riotId.trim(), tag: item.tag.trim() })).filter((item) => item.riotId || item.tag)
  if (!rows.length || rows.some((item) => !item.riotId || !item.tag)) return null
  const unique = rows.filter((item, position) => rows.findIndex((other) => sameAccount(other, item)) === position)
  const known = (item: { riotId: string; tag: string }) => previous.find((old) => sameAccount(old, item))
  const [first, ...others] = unique
  const knownFirst = known(first)
  return {
    primary: { riotId: first.riotId, tag: first.tag, puuid: knownFirst?.puuid, syncedAt: knownFirst?.syncedAt ?? new Date(0) },
    extras: others.map((item): RiotAccount => {
      const old = known(item)
      return { riotId: item.riotId, tag: item.tag, ...(old?.puuid ? { puuid: old.puuid } : {}), ...(old && old.syncedAt.getTime() > 0 ? { syncedAt: old.syncedAt.toISOString() } : {}) }
    }),
  }
}

// Firestore는 undefined 값을 저장하지 못한다. 저장 전에 빈 필드를 제거한다.
export function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

// ── 저장된 분석 데이터 찾기 ────────────────────────────────────────────
export type SavedAccount = { puuid?: string; gameName?: string; tagLine?: string }

// 저장된 분석 데이터가 이 아이디의 것인가. puuid를 서로 알면 puuid로, 아니면 Riot ID(대소문자·공백 무시)로 비교한다.
export function matchesAccount(target: { puuid?: string; riotId: string; tag: string }, account?: SavedAccount | null) {
  if (!account || account.puuid === AGGREGATE_PUUID) return false
  if (target.puuid && account.puuid) return target.puuid === account.puuid
  const name = normalizeRiotId(account.gameName)
  return Boolean(name) && name === normalizeRiotId(target.riotId) && normalizeRiotId(account.tagLine) === normalizeRiotId(target.tag)
}

// 저장된 문서들 중 이 아이디의 것을 고른다.
// 예전에는 사용자 ID(directId)로 저장했으므로 그 문서를 우선하되, 같은 계정일 때만 인정한다.
// (대표 아이디를 바꾸면 그 문서는 이전 대표 아이디의 데이터라서 새 대표 아이디의 것으로 보면 안 된다.)
export function pickSummary<T extends { id: string; account?: SavedAccount | null }>(docs: T[], directId: string, target: { puuid?: string; riotId: string; tag: string }): T | null {
  const direct = docs.find((doc) => doc.id === directId)
  if (direct && matchesAccount(target, direct.account)) return direct
  return docs.find((doc) => matchesAccount(target, doc.account)) ?? null
}

// ── 목록 순서, 주 라인 ────────────────────────────────────────────────
// 목록의 index번째 항목을 delta칸 옮긴 새 목록. 범위를 벗어나면 그대로 돌려준다.
export function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  const next = [...list]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

// 판수가 가장 많은 라인(주 라인). 같으면 한 챔피언을 가장 많이 한 라인, 그래도 같으면 라인 이름순. 판이 없으면 null.
export function mostPlayedLane<T extends string>(champions: { lane: T; games: number }[]): T | null {
  const totals = new Map<T, { games: number; best: number }>()
  for (const champion of champions) {
    const current = totals.get(champion.lane) ?? { games: 0, best: 0 }
    current.games += champion.games
    current.best = Math.max(current.best, champion.games)
    totals.set(champion.lane, current)
  }
  const ranked = [...totals.entries()].filter(([, value]) => value.games > 0)
    .sort((a, b) => b[1].games - a[1].games || b[1].best - a[1].best || String(a[0]).localeCompare(String(b[0])))
  return ranked.length ? ranked[0][0] : null
}
