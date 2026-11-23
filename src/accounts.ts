// 한 사용자가 가진 여러 Riot 아이디를 다루는 순수 계산 모음 (화면·Firebase와 무관해서 단독으로 테스트할 수 있다).
// 대표 아이디는 사용자의 riotId/tag/puuid/syncedAt에, 나머지는 extraAccounts에 저장한다.
// 그래서 아이디가 하나뿐인 기존 데이터는 그대로 호환된다.

export type RiotAccount = { riotId: string; tag: string; puuid?: string; syncedAt?: string }
export type AccountRef = { index: number; riotId: string; tag: string; puuid?: string; syncedAt: Date }
// 'all' = 모든 아이디 통합, 숫자 = accountsOf(profile)의 위치 (0이 대표 아이디)
export type AccountSel = 'all' | number
export type AccountOwner = { riotId: string; tag: string; puuid?: string; syncedAt: Date; extraAccounts?: RiotAccount[] }

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

// 아이디가 둘 이상이면 처음에는 통합 통계를 보여준다.
export const defaultSelection = (profile: AccountOwner): AccountSel => (accountsOf(profile).length > 1 ? 'all' : 0)

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
