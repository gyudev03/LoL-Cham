import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import {
  Check, ChevronDown, ChevronUp, CircleAlert, Flame, Gauge, Plus, RefreshCw,
  Pencil, Search, ShieldAlert, Sparkles, Trophy, Users, X, LogIn, LogOut, Upload, Trash2, Database,
} from 'lucide-react'
import { auth, db, googleProvider } from './firebase'

type Lane = 'TOP' | 'JUNGLE' | 'MID' | 'BOTTOM' | 'SUPPORT'

type Profile = {
  id: number
  name: string
  riotId: string
  tag: string
  puuid?: string
  lane: Lane
  active: boolean
  order?: number
  syncedAt: Date
}

type Champion = {
  id: string
  entryId?: string
  name: string
  lane: Lane
  image: string
  tier: 'S' | 'A' | 'B' | '—'
  mastery: number
  masteryLevel: number
  aiScore: number | null
  winRate: number | null
  games: number
  lastPlayed: string
  analysisNote?: string
  scoreNote?: string
  rawScore?: number | null
  fit?: { delta: number; baseline: number; games: number } | null
  runes?: string[]
  runeInfo?: {
    primaryTree: string
    primaryRunes: string[]
    secondaryTree: string | null
    secondaryRunes: string[]
    shards: string[]
    games: number
    pickRate: number
    winRate: number
  } | null
  counters: { good: string[]; difficult: string[] }
  strengths: string[]
  improvements: string[]
  metrics: { label: string; value: string; tone: 'good' | 'neutral' | 'warn'; detail?: string }[]
  scoreBreakdown?: { label: string; points: number; max: number; detail: string }[]
}

type LocalCacheEntry = {
  puuid: string; gameName: string; tagLine: string
  matchCount: number; hasSummary: boolean; championCount: number; syncedAt: string | null
}

type SeasonTotals = { games: number; wins: number }

type SyncResult = {
  champions: Champion[]
  account: { puuid: string; gameName: string; tagLine: string; rank?: string }
  totals?: SeasonTotals
  syncedAt: string
}

const tierNames: Record<string, string> = {
  IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘', EMERALD: '에메랄드',
  DIAMOND: '다이아몬드', MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
}
const apexTiers = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER'])
function formatRank(rank?: string) {
  if (!rank || rank === '랭크 정보 없음') return null
  const [tier, division, points] = rank.split(' ')
  const name = tierNames[tier] ?? tier
  return { label: apexTiers.has(tier) ? name : `${name} ${division}`, points: points ?? '' }
}

const sharedProfiles = collection(db, 'shared', 'chamlog', 'profiles')
const summariesCol = collection(db, 'shared', 'chamlog', 'summaries')
const summaryRef = (profileId: number) => doc(db, 'shared', 'chamlog', 'summaries', String(profileId))
const syncApiBase = import.meta.env.VITE_SYNC_API_URL || '/api'
const hasSyncServer = window.location.hostname === 'localhost' || Boolean(import.meta.env.VITE_SYNC_API_URL)

const laneLabels: Record<Lane, string> = {
  TOP: '탑', JUNGLE: '정글', MID: '미드', BOTTOM: '원딜', SUPPORT: '서포터',
}

function formatMastery(value: number) { return new Intl.NumberFormat('ko-KR').format(value) }
function syncAge(date: Date) {
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return '동기화 기록 없음'
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3600000))
  return hours === 0 ? '방금 전' : `${hours}시간 전`
}
function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}분 ${seconds % 60}초` : `${seconds}초`
}

// 기본 선택: 선호 라인에서 숙련도 점수가 가장 높은 챔피언, 그 라인에 없으면 전체에서 가장 높은 챔피언
function topChampion(list: Champion[], preferredLane?: Lane) {
  const best = (items: Champion[]) => items.reduce<Champion | undefined>((top, item) => !top || (item.aiScore ?? -1) > (top.aiScore ?? -1) ? item : top, undefined)
  return (preferredLane && best(list.filter((item) => item.lane === preferredLane))) || best(list)
}

function championEntryId(champion: Champion) { return champion.entryId ?? champion.id }
function aiGrade(score: number | null) {
  if (score === null) return '데이터 부족'
  if (score >= 80) return '매우 숙련'
  if (score >= 65) return '안정적'
  if (score >= 50) return '보통'
  return '보완 필요'
}

// 저장된 분석 데이터는 사용자 ID가 아니라 Riot 계정(puuid, 없으면 Riot ID#태그)으로 사용자와 연결한다.
// 그래서 사용자를 삭제했다가 같은 Riot ID로 다시 추가해도 기존 분석 데이터를 그대로 쓸 수 있다.
type AccountLike = { puuid?: string; gameName?: string; tagLine?: string }
const normalizeRiotId = (value?: string) => (value ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase()
function accountMatchesProfile(target: Pick<Profile, 'puuid' | 'riotId' | 'tag'>, account?: AccountLike | null) {
  if (!account) return false
  if (target.puuid && account.puuid) return target.puuid === account.puuid
  const name = normalizeRiotId(account.gameName)
  return Boolean(name) && name === normalizeRiotId(target.riotId) && normalizeRiotId(account.tagLine) === normalizeRiotId(target.tag)
}
async function resolveSummaryRef(target: Pick<Profile, 'id' | 'puuid' | 'riotId' | 'tag'>) {
  const direct = summaryRef(target.id)
  if ((await getDoc(direct)).exists()) return direct
  const snapshot = await getDocs(summariesCol)
  const matched = snapshot.docs.find((item) => accountMatchesProfile(target, (item.data() as SyncResult).account))
  return matched ? matched.ref : direct
}
async function findLocalPuuid(target: Profile) {
  try {
    const response = await fetch(`${syncApiBase}/riot/cache`)
    if (!response.ok) return undefined
    const payload = await response.json() as { players?: LocalCacheEntry[] }
    return payload.players?.find((item) => accountMatchesProfile(target, item))?.puuid
  } catch {
    return undefined
  }
}

function profileFromStorage(item: Omit<Profile, 'syncedAt'> & { syncedAt?: string | Date }) {
  return { ...item, syncedAt: item.syncedAt ? new Date(item.syncedAt) : new Date(0) }
}

function profileForStorage(item: Profile) {
  return { ...item, syncedAt: item.syncedAt.toISOString() }
}

function sortProfiles(list: Profile[]) {
  return list.every((item) => typeof item.order === 'number') ? [...list].sort((a, b) => (a.order as number) - (b.order as number)) : list
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState<number | null>(null)
  const [lane, setLane] = useState<Lane>('MID')
  const [selectedId, setSelectedId] = useState('')
  const [championData, setChampionData] = useState<Champion[]>([])
  const [sortBy, setSortBy] = useState<'ai' | 'mastery' | 'win'>('ai')
  const [isUserModalOpen, setUserModalOpen] = useState(false)
  const [isDataModalOpen, setDataModalOpen] = useState(false)
  const [summaryMeta, setSummaryMeta] = useState<{ rank?: string; totals?: SeasonTotals } | null>(null)
  const [isSyncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [syncProgress, setSyncProgress] = useState('')
  const [syncTiming, setSyncTiming] = useState('')
  const [syncJobId, setSyncJobId] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState('')
  const [profileError, setProfileError] = useState('')
  const [isLiveData, setLiveData] = useState(false)
  const [isSharedData, setSharedData] = useState(false)
  const [hasLocalOnlyData, setLocalOnlyData] = useState(false)
  const [authUser, setAuthUser] = useState<User | null>(null)
  const [isAdmin, setAdmin] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [query, setQuery] = useState('')
  const profile = profiles.find((item) => item.id === profileId)
  const selected = championData.find((item) => championEntryId(item) === selectedId) ?? championData[0]

  useEffect(() => onAuthStateChanged(auth, async (user) => {
    setAuthUser(user)
    if (!user) { setAdmin(false); return }
    try {
      const admin = await getDoc(doc(db, 'admins', user.uid))
      const allowed = admin.exists() && admin.data().enabled === true
      setAdmin(allowed)
      if (!allowed) setProfileError(`관리자 권한이 없습니다. Firebase Console의 admins/${user.uid} 문서에 enabled: true를 등록하세요.`)
    } catch {
      setAdmin(false)
    }
  }), [])

  useEffect(() => {
    async function loadProfiles() {
      try {
        const sharedSnapshot = await getDocs(sharedProfiles)
        let savedProfiles = sharedSnapshot.docs.map((item) => profileFromStorage(item.data() as Omit<Profile, 'syncedAt'> & { syncedAt?: string | Date }))
        if (savedProfiles.length) setSharedData(true)
        if (!savedProfiles.length) {
          const response = await fetch(`${syncApiBase}/users`)
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.message || '저장된 사용자 정보를 불러오지 못했습니다.')
          savedProfiles = Array.isArray(payload.users) ? payload.users.map(profileFromStorage) : []
          setSharedData(false)
        }
        if (!savedProfiles.length) return
        savedProfiles = sortProfiles(savedProfiles)
        setProfiles(savedProfiles)
        const active = savedProfiles.find((item: Profile) => item.active) ?? savedProfiles[0]
        setProfileId(active.id)
        setLane(active.lane)
        void loadCachedData(active)
      } catch (error) {
        setProfileError(error instanceof Error ? error.message : '사용자 정보를 불러오지 못했습니다.')
      }
    }
    void loadProfiles()
  }, [])

  // 사용자 전체 시즌 승률: 서버가 집계한 값을 쓰고, 예전 데이터는 챔피언별 값으로 계산한다.
  const seasonRecord = useMemo<SeasonTotals | null>(() => {
    if (summaryMeta?.totals?.games) return summaryMeta.totals
    const games = championData.reduce((sum, item) => sum + item.games, 0)
    const wins = Math.round(championData.reduce((sum, item) => sum + (item.winRate ?? 0) * item.games / 100, 0))
    return games ? { games, wins } : null
  }, [summaryMeta, championData])
  const rankInfo = formatRank(summaryMeta?.rank)

  const laneChampions = useMemo(() => championData
    .filter((champion) => champion.lane === lane && champion.name.includes(query.trim()))
    .sort((a, b) => sortBy === 'mastery' ? b.mastery - a.mastery : sortBy === 'win' ? (b.winRate ?? 0) - (a.winRate ?? 0) : (b.aiScore ?? 0) - (a.aiScore ?? 0)), [championData, lane, query, sortBy])

  function switchLane(nextLane: Lane) {
    setLane(nextLane)
    const first = topChampion(championData.filter((champion) => champion.lane === nextLane))
    if (first) setSelectedId(championEntryId(first))
  }

  async function loadCachedData(targetProfile: Profile) {
    setSyncError('')
    setChampionData([])
    setSelectedId('')
    setLiveData(false)
    setSummaryMeta(null)
    try {
      let payload: SyncResult | null = null
      const directSummary = await getDoc(summaryRef(targetProfile.id))
      if (directSummary.exists()) {
        payload = directSummary.data() as SyncResult
      } else {
        // 사용자 ID로 저장된 데이터가 없으면 같은 Riot 계정으로 저장된 데이터를 찾는다.
        const snapshot = await getDocs(summariesCol)
        const matched = snapshot.docs.find((item) => accountMatchesProfile(targetProfile, (item.data() as SyncResult).account))
        if (matched) payload = matched.data() as SyncResult
      }
      setSharedData(Boolean(payload))
      setLocalOnlyData(false)
      if (!payload) {
        const puuid = targetProfile.puuid || (hasSyncServer ? await findLocalPuuid(targetProfile) : undefined)
        if (puuid) {
          const response = await fetch(`${syncApiBase}/riot/summary/${encodeURIComponent(puuid)}`)
          if (response.ok) {
            payload = await response.json() as SyncResult
            setLocalOnlyData(true)
          } else if (response.status !== 404) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body.message || '저장된 분석 데이터를 불러오지 못했습니다.')
          }
        }
      }
      if (!payload?.champions?.length) return
      const loaded = payload
      setSummaryMeta({ rank: loaded.account?.rank, totals: loaded.totals })
      if (loaded.account?.puuid && !targetProfile.puuid && accountMatchesProfile(targetProfile, loaded.account)) {
        setProfiles((current) => current.map((item) => item.id === targetProfile.id && !item.puuid
          ? { ...item, puuid: loaded.account.puuid, syncedAt: loaded.syncedAt ? new Date(loaded.syncedAt) : item.syncedAt }
          : item))
      }
      setChampionData(payload.champions)
      setLiveData(true)
      const preferred = topChampion(payload.champions, targetProfile.lane) as Champion
      setLane(preferred.lane)
      setSelectedId(championEntryId(preferred))
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '저장된 분석 데이터를 불러오지 못했습니다.')
    }
  }

  async function refreshData(targetProfile = profile) {
    if (!targetProfile) return
    if (!isAdmin) {
      setSyncError('데이터 동기화는 관리자 Google 로그인 후에만 할 수 있습니다.')
      return
    }
    if (!hasSyncServer) {
      setSyncError('GitHub Pages에는 Riot 동기화 서버가 없습니다. 관리자 PC에서 로컬 동기화 도구를 실행한 뒤 결과를 공용 데이터로 저장하세요.')
      return
    }
    setSyncing(true)
    setSyncError('')
    setSyncNotice('')
    setSyncProgress('동기화 작업을 시작하는 중')
    setSyncTiming('')
    try {
      const response = await fetch(`${syncApiBase}/riot/sync`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameName: targetProfile.riotId, tagLine: targetProfile.tag }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '동기화 중 오류가 발생했습니다.')
      setSyncJobId(payload.id)
      const result = await waitForSync(payload.id)
      if (!result.champions.length) throw new Error('이번 시즌에 분석 가능한 솔로·자유랭크 전적을 찾지 못했습니다.')
      setChampionData(result.champions)
      setLiveData(true)
      setSummaryMeta({ rank: result.account.rank, totals: result.totals })
      setProfiles((current) => {
        const nextProfiles = current.map((item) => item.id === targetProfile.id ? { ...item, riotId: result.account.gameName, tag: result.account.tagLine, puuid: result.account.puuid, syncedAt: new Date(result.syncedAt) } : item)
        const updatedProfile = nextProfiles.find((item) => item.id === targetProfile.id) ?? targetProfile
        void persistProfiles(nextProfiles)
          .then(() => resolveSummaryRef(updatedProfile))
          .then((ref) => setDoc(ref, result))
          .then(() => { setSharedData(true); setLocalOnlyData(false) })
          .catch((error) => setProfileError(error instanceof Error ? error.message : '공유 데이터를 저장하지 못했습니다.'))
        return nextProfiles
      })
      const preferred = topChampion(result.champions, lane) as Champion
      setLane(preferred.lane)
      setSelectedId(championEntryId(preferred))
    } catch (error) {
      const message = error instanceof Error ? error.message : '동기화 중 오류가 발생했습니다.'
      if (message === '동기화가 취소되었습니다.') setSyncNotice('동기화를 취소했습니다. 수집된 게임은 다음 동기화 때 재사용됩니다.')
      else setSyncError(message)
    } finally {
      setSyncing(false)
      setSyncProgress('')
      setSyncTiming('')
      setSyncJobId(null)
    }
  }

  async function cancelSync() {
    if (!syncJobId) return
    setSyncProgress('동기화 취소를 요청하는 중')
    await fetch(`${syncApiBase}/riot/sync/${syncJobId}`, { method: 'DELETE' })
  }

  async function persistProfiles(nextProfiles: Profile[]) {
    if (!isAdmin) throw new Error('사용자 정보 수정은 관리자만 할 수 있습니다.')
    await Promise.all(nextProfiles.map((item) => setDoc(doc(sharedProfiles, String(item.id)), profileForStorage(item))))
    setSharedData(true)
  }

  async function saveUserProfiles(nextProfiles: Profile[]) {
    setProfileError('')
    await persistProfiles(nextProfiles)
    // 삭제한 사용자 문서만 지운다. 저장된 분석 데이터(summaries)는 건드리지 않는다.
    const removed = profiles.filter((old) => !nextProfiles.some((item) => item.id === old.id))
    await Promise.all(removed.map((old) => deleteDoc(doc(sharedProfiles, String(old.id)))))
    setProfiles(nextProfiles)
    const nextActive = nextProfiles.find((item) => item.id === profileId && item.active) ?? nextProfiles.find((item) => item.active)
    if (nextActive) { setProfileId(nextActive.id); setLane(nextActive.lane); void loadCachedData(nextActive) }
    else if (!nextProfiles.some((item) => item.id === profileId)) { setProfileId(null); setChampionData([]); setSelectedId(''); setLiveData(false) }
    setUserModalOpen(false)
  }

  async function publishLocalData() {
    if (!profile || !isAdmin || !championData.length) return
    try {
      await persistProfiles(profiles)
      await setDoc(await resolveSummaryRef(profile), {
        account: { puuid: profile.puuid || '', gameName: profile.riotId, tagLine: profile.tag, ...(summaryMeta?.rank ? { rank: summaryMeta.rank } : {}) },
        ...(summaryMeta?.totals ? { totals: summaryMeta.totals } : {}),
        champions: championData,
        syncedAt: profile.syncedAt.toISOString(),
      })
      setSharedData(true)
      setLocalOnlyData(false)
      setSyncNotice('현재 PC의 분석 결과를 공용 Firebase 데이터로 저장했습니다.')
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : '공유 데이터를 저장하지 못했습니다.')
    }
  }

  async function signInAsManager() {
    setAuthBusy(true)
    setProfileError('')
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : 'Google 로그인에 실패했습니다.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function signOutManager() {
    await signOut(auth)
    setAdmin(false)
  }

  async function waitForSync(jobId: string): Promise<SyncResult> {
    while (true) {
      const response = await fetch(`${syncApiBase}/riot/sync/${jobId}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '동기화 상태를 확인하지 못했습니다.')
      setSyncProgress(payload.total ? `${payload.message} (${payload.fetched}/${payload.total})` : payload.message)
      const elapsedSeconds = (Date.now() - new Date(payload.startedAt).getTime()) / 1000
      const remainingSeconds = payload.total && payload.fetched ? (elapsedSeconds / payload.fetched) * (payload.total - payload.fetched) : 0
      setSyncTiming(payload.total ? `경과 ${formatDuration(elapsedSeconds)} · 예상 남음 ${payload.fetched ? formatDuration(remainingSeconds) : '계산 중'}` : `경과 ${formatDuration(elapsedSeconds)}`)
      if (payload.status === 'completed') return payload.result
      if (payload.status === 'failed') throw new Error(payload.error || '동기화 중 오류가 발생했습니다.')
      if (payload.status === 'cancelled') throw new Error('동기화가 취소되었습니다.')
      await new Promise((resolve) => window.setTimeout(resolve, 1000))
    }
  }

  function selectProfile(next: Profile) {
    setProfileId(next.id)
    setLane(next.lane)
    void loadCachedData(next)
  }

  if (!profile) {
    return <main className="app-shell"><header className="topbar"><a className="brand" href="#top"><span>CHAM</span>LOG <i /></a><ManagerButton user={authUser} isAdmin={isAdmin} busy={authBusy} onSignIn={signInAsManager} onSignOut={signOutManager} /></header><section className="empty-onboarding"><Users size={34} /><p className="eyebrow">분석 사용자 없음</p><h1>먼저 분석할<br /><em>사용자</em>를 등록하세요.</h1><p>{isAdmin ? 'Riot ID, 태그, 기본 라인을 저장한 뒤 데이터 새로고침을 눌러 첫 동기화를 진행하세요.' : '공용 분석 데이터가 아직 없습니다. 관리자가 로그인해 사용자를 추가할 수 있습니다.'}</p>{isAdmin && <div className="onboarding-actions"><button className="primary-button" onClick={() => setUserModalOpen(true)}><Plus size={17} /> 사용자 추가</button><button className="ghost-button" onClick={() => setDataModalOpen(true)}><Database size={17} /> 저장 데이터 관리</button></div>}</section>{isUserModalOpen && isAdmin && <UserModal profiles={profiles} onClose={() => setUserModalOpen(false)} onSave={saveUserProfiles} />}{isDataModalOpen && isAdmin && <DataModal profiles={profiles} onClose={() => setDataModalOpen(false)} onChanged={() => undefined} />}</main>
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Chamlog 홈"><span>CHAM</span>LOG <i /></a>
        <div className="header-actions">
          {isAdmin && <button className="ghost-button" onClick={() => setDataModalOpen(true)} aria-label="저장 데이터 관리" title="저장 데이터 관리"><Database size={17} /><span className="btn-label">저장 데이터</span></button>}
          {isAdmin && <button className="ghost-button" onClick={() => setUserModalOpen(true)} aria-label="사용자 관리" title="사용자 관리"><Users size={17} /><span className="btn-label">사용자 관리</span></button>}
          <ManagerButton user={authUser} isAdmin={isAdmin} busy={authBusy} onSignIn={signInAsManager} onSignOut={signOutManager} />
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy"><p className="eyebrow"><Sparkles size={14} /> 개인 챔피언 분석</p><h1>LoL-Cham</h1></div>
        <div className="sync-card">
          <div><p>데이터 상태</p><strong><span className={`status-dot ${syncError ? 'error' : ''}`} /> {syncError ? '동기화 오류' : isSyncing ? '시즌 전적 동기화 중' : isLiveData ? '저장된 분석 데이터' : '동기화 대기'}</strong><small>{isSyncing ? syncProgress : `마지막 동기화: ${syncAge(profile.syncedAt)}`}</small>{isSyncing && <small className="sync-timing">{syncTiming}</small>}</div>
          {hasLocalOnlyData && isAdmin ? <button className="refresh-button" onClick={() => void publishLocalData()}><Upload size={16} /> 공용 데이터로 저장</button> : isAdmin && hasSyncServer ? <button className={`refresh-button ${isSyncing ? 'cancel-sync' : ''}`} onClick={() => isSyncing ? void cancelSync() : void refreshData(profile)}>{isSyncing ? <X size={16} /> : <RefreshCw size={16} />}{isSyncing ? '동기화 취소' : '데이터 새로고침'}</button> : isAdmin ? <button className="refresh-button" disabled title="관리자 PC의 로컬 동기화 도구가 필요합니다."><RefreshCw size={16} /> 로컬 동기화 필요</button> : <button className="refresh-button" disabled title="관리자만 동기화할 수 있습니다."><RefreshCw size={16} /> 관리자 전용</button>}
        </div>
      </section>
      {syncError && <p className="sync-error"><CircleAlert size={15} /> {syncError}</p>}
      {syncNotice && <p className="sync-notice"><Check size={15} /> {syncNotice}</p>}
      {profileError && <p className="sync-error"><CircleAlert size={15} /> {profileError}</p>}

      <section className="profile-bar">
        <div className="profile-select-wrap">
          <label>분석 사용자</label>
          <div className="select-with-icon"><Users size={16} /><select value={profileId ?? ''} onChange={(event) => { const next = profiles.find((p) => p.id === Number(event.target.value)); if (next) selectProfile(next) }}>
            {profiles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.riotId}#{item.tag}</option>)}
          </select><ChevronDown size={16} /></div>
        </div>
        <div className="profile-info"><div className="rank-emblem"><Trophy size={20} /></div><div><strong>{profile.riotId}<span>#{profile.tag}</span></strong><p>KR 서버 · 기본 라인 <b>{laneLabels[profile.lane]}</b></p></div></div>
        <div className="profile-stats">
          <div className="profile-stat"><small>현재 티어</small><strong>{rankInfo ? rankInfo.label : '—'}</strong><span>{rankInfo ? rankInfo.points : isLiveData ? '랭크 정보 없음' : '동기화 필요'}</span></div>
          <div className="profile-stat"><small>시즌 승률</small><strong>{seasonRecord ? `${(seasonRecord.wins / seasonRecord.games * 100).toFixed(1)}%` : '—'}</strong><span>{seasonRecord ? `${seasonRecord.games}판 · ${seasonRecord.wins}승 ${seasonRecord.games - seasonRecord.wins}패` : '집계된 데이터 없음'}</span></div>
        </div>
      </section>

      <nav className="lane-tabs" aria-label="라인 선택">
        {(Object.keys(laneLabels) as Lane[]).map((key) => <button key={key} className={lane === key ? 'active' : ''} onClick={() => switchLane(key)}>{laneLabels[key]}{profile.lane === key && <span>기본</span>}</button>)}
      </nav>

      <section className="workspace">
        <div className="champion-panel panel">
          <div className="panel-heading"><div><p className="eyebrow">{laneLabels[lane]} 챔피언</p><h2>챔피언 목록 <small>{laneChampions.length}</small></h2></div><div className="filter-row"><label className="search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="챔피언 검색" /></label><select aria-label="정렬" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}><option value="ai">숙련도 점수순</option><option value="mastery">공식 숙련도순</option><option value="win">시즌 승률순</option></select></div></div>
          <p className="data-notice"><CircleAlert size={14} /> {isLiveData ? `${isSharedData ? '공용 Firebase' : '현재 PC'}에 저장된 이번 시즌 솔로·자유랭크 분석 데이터입니다.${isAdmin ? ' 새 게임 반영은 관리자만 할 수 있습니다.' : ''}` : '저장된 분석 데이터가 없습니다. 관리자에게 동기화를 요청하세요.'}</p>
          <div className="table-head"><span>챔피언</span><span>공식 숙련도</span><span>숙련도 점수</span><span>시즌 승률</span><span>내 라인 평균 대비</span></div>
          <div className="champion-list">
            {laneChampions.map((champion) => <button key={championEntryId(champion)} className={`champion-row ${selectedId === championEntryId(champion) ? 'selected' : ''}`} onClick={() => setSelectedId(championEntryId(champion))}>
              <span className="champion-name"><img src={champion.image} alt="" /><b>{champion.name}</b></span>
              <span><b>{champion.masteryLevel}레벨</b><small>{formatMastery(champion.mastery)}점</small></span>
              <span className="score"><b>{champion.aiScore ?? '—'}</b><small>{champion.analysisNote ? `표본 보정 · ${aiGrade(champion.aiScore)}` : aiGrade(champion.aiScore)}</small></span>
              <span><b>{champion.winRate !== null ? `${champion.winRate}%` : '—'}</b><small>{champion.games}게임</small></span>
              <span title={champion.fit ? `내 ${laneLabels[champion.lane]} 다른 챔피언 ${champion.fit.games}판 평균 ${champion.fit.baseline}점 기준` : undefined}>{champion.fit ? <><b className={`fit-delta ${champion.fit.delta > 0 ? 'up' : champion.fit.delta < 0 ? 'down' : ''}`}>{champion.fit.delta > 0 ? '+' : ''}{champion.fit.delta}점</b><small>다른 챔피언 {champion.fit.games}판 기준</small></> : <><b>—</b><small>비교 데이터 부족</small></>}</span>
            </button>)}
            {!laneChampions.length && <div className="empty">검색 결과가 없습니다.</div>}
          </div>
        </div>

        {selected ? <aside className="detail-panel panel">
          <div className="detail-title"><img src={selected.image} alt="" /><div><p className="eyebrow">{laneLabels[selected.lane]}</p><h2>{selected.name}</h2></div></div>
          <DetailBlock icon={<Sparkles size={17} />} title="룬 정보">
            {selected.runeInfo ? <RuneInfo info={selected.runeInfo} /> : <div className="runes">{(selected.runes || ['룬 정보를 찾지 못했습니다.']).map((rune, index) => <span key={rune} className={index === 0 ? 'keystone' : ''}>{rune}</span>)}</div>}
            <small className="source-note">{isLiveData ? '이번 시즌 해당 라인에서 가장 많이 사용한 룬 조합입니다. 룬 명칭은 Riot Data Dragon 기준입니다.' : 'Riot API 연동 후 최근 전적 기반 룬 정보로 바뀝니다.'}</small>
          </DetailBlock>
          <DetailBlock icon={<Trophy size={17} />} title="공식 숙련도"><div className="mastery-stat"><div><strong>{selected.masteryLevel}</strong><span>레벨</span></div><div><b>{formatMastery(selected.mastery)}점</b><small>챔피언 숙련도 점수</small></div><div><b>{selected.games}회</b><small>{isLiveData ? '시즌 분석 게임' : '최근 분석 게임'}</small></div></div></DetailBlock>
          <DetailBlock icon={<Gauge size={17} />} title="숙련도 점수"><div className="ai-summary"><div className="score-ring" style={{ '--score': `${selected.aiScore ?? 0}%` } as CSSProperties}><b>{selected.aiScore ?? '—'}</b><small>점</small></div><div><strong>{aiGrade(selected.aiScore)}</strong>{selected.fit && <span className={`fit-chip ${selected.fit.delta >= 0 ? 'up' : 'down'}`} title={`내 ${laneLabels[selected.lane]} 다른 챔피언 ${selected.fit.games}판 평균 ${selected.fit.baseline}점 기준`}>내 {laneLabels[selected.lane]} 평균 대비 {selected.fit.delta > 0 ? '+' : ''}{selected.fit.delta}점</span>}<p>시즌 승률 {selected.winRate ?? '—'}% · 최근 플레이 {selected.lastPlayed}</p><div className="metric-tags">{selected.metrics.map((metric) => <span className={metric.tone} key={metric.label} title={metric.detail}>{metric.label} <b>{metric.value}</b></span>)}</div></div></div>
            {selected.analysisNote && <p className="analysis-note"><CircleAlert size={13} /> {selected.analysisNote}</p>}
            <div className="insight-grid"><Insight title="강점" icon={<Check size={15} />} values={selected.strengths} tone="good" /><Insight title="개선할 점" icon={<Flame size={15} />} values={selected.improvements} tone="warn" /></div>
            {selected.scoreBreakdown && <ScoreBreakdown items={selected.scoreBreakdown} note={selected.scoreNote} />}
          </DetailBlock>
        </aside> : <aside className="detail-panel panel detail-empty"><Gauge size={28} /><h2>{isSyncing ? '시즌 전적을 분석하고 있습니다' : '챔피언을 기다리고 있습니다'}</h2><p>{isSyncing ? '동기화가 끝나면 실제 플레이한 챔피언이 표시됩니다.' : '새로고침으로 해당 사용자의 챔피언 데이터를 불러오세요.'}</p></aside>}
      </section>

      {isUserModalOpen && isAdmin && <UserModal profiles={profiles} onClose={() => setUserModalOpen(false)} onSave={saveUserProfiles} />}
      {isDataModalOpen && isAdmin && <DataModal profiles={profiles} onClose={() => setDataModalOpen(false)} onChanged={() => void loadCachedData(profile)} />}
    </main>
  )
}

function ManagerButton({ user, isAdmin, busy, onSignIn, onSignOut }: { user: User | null; isAdmin: boolean; busy: boolean; onSignIn: () => Promise<void>; onSignOut: () => Promise<void> }) {
  if (!user) return <button className="ghost-button" disabled={busy} onClick={() => void onSignIn()}><LogIn size={16} /> {busy ? '로그인 중' : '관리자 로그인'}</button>
  if (!isAdmin) return <button className="ghost-button" onClick={() => void onSignOut()} title={user.email || undefined}><ShieldAlert size={16} /> 권한 없음</button>
  return <button className="ghost-button manager-account" onClick={() => void onSignOut()} title="로그아웃"><Check size={16} /> 관리자 <LogOut size={14} /></button>
}

function DetailBlock({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="detail-block"><h3>{icon}{title}</h3>{children}</section>
}


function RuneInfo({ info }: { info: NonNullable<Champion['runeInfo']> }) {
  return <div className="rune-info">
    <div className="rune-usage"><b>{info.games}게임 사용 · {info.pickRate}%</b><span>해당 조합 승률 {info.winRate}%</span></div>
    <div className="rune-paths">
      <div className="rune-path primary"><small>주 룬 · {info.primaryTree}</small><div>{info.primaryRunes.map((rune, index) => <span key={rune} className={index === 0 ? 'keystone' : ''}>{rune}</span>)}</div></div>
      {info.secondaryTree && <div className="rune-path"><small>보조 룬 · {info.secondaryTree}</small><div>{info.secondaryRunes.map((rune) => <span key={rune}>{rune}</span>)}</div></div>}
    </div>
    {info.shards.length > 0 && <div className="rune-shards"><small>능력치 파편</small><span>{info.shards.join(' · ')}</span></div>}
  </div>
}

function Insight({ title, icon, values, tone }: { title: string; icon: ReactNode; values: string[]; tone: 'good' | 'warn' }) {
  return <div className={`insight ${tone}`}><strong>{icon}{title}</strong>{values.map((value) => <p key={value}>{value}</p>)}</div>
}

function ScoreBreakdown({ items, note }: { items: NonNullable<Champion['scoreBreakdown']>; note?: string }) {
  return <div className="score-breakdown">
    <strong>점수 구성 <small>100점 만점</small></strong>
    {items.map((item) => <div className="breakdown-row" key={item.label}>
      <div className="breakdown-head"><span>{item.label}</span><b>{item.points}<small> / {item.max}</small></b></div>
      <div className="breakdown-bar"><i style={{ width: `${item.max ? Math.min(100, (item.points / item.max) * 100) : 0}%` }} /></div>
      <p>{item.detail}</p>
    </div>)}
    {note && <p className="breakdown-note">{note}</p>}
    <p className="breakdown-note">지표별 기준 범위는 이 앱이 정한 고정값이며, 같은 티어 평균과 비교한 점수가 아닙니다. 판수는 점수에 더하지 않고, 15판 미만일 때만 점수를 50점 쪽으로 보정합니다.</p>
  </div>
}

function UserModal({ profiles, onClose, onSave }: { profiles: Profile[]; onClose: () => void; onSave: (profiles: Profile[]) => Promise<void> }) {
  const [rows, setRows] = useState(profiles)
  const [isAdding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', riotId: '', tag: '', lane: 'MID' as Lane })
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  function startEdit(user: Profile) {
    setForm({ name: user.name, riotId: user.riotId, tag: user.tag, lane: user.lane })
    setEditingId(user.id)
    setAdding(true)
  }
  function removeUser(user: Profile) {
    if (!window.confirm(`'${user.name}' (${user.riotId}#${user.tag}) 사용자를 삭제할까요?\n\n저장된 분석 데이터는 삭제되지 않습니다. 같은 Riot ID로 다시 추가하면 기존 분석 데이터를 그대로 사용합니다.\n\n'변경사항 저장'을 눌러야 삭제가 반영됩니다.`)) return
    setRows((current) => current.filter((row) => row.id !== user.id))
    if (editingId === user.id) { setEditingId(null); setAdding(false); setForm({ name: '', riotId: '', tag: '', lane: 'MID' }) }
  }
  function move(index: number, delta: number) {
    setRows((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  function saveForm() {
    if (!form.name.trim() || !form.riotId.trim() || !form.tag.trim()) return
    if (editingId === null) {
      setRows((current) => [...current, { id: Date.now(), ...form, active: true, syncedAt: new Date(0) }])
    } else {
      setRows((current) => current.map((user) => {
        if (user.id !== editingId) return user
        const accountChanged = user.riotId.trim() !== form.riotId.trim() || user.tag.trim() !== form.tag.trim()
        return accountChanged ? { ...user, ...form, puuid: undefined, syncedAt: new Date(0) } : { ...user, ...form }
      }))
    }
    setForm({ name: '', riotId: '', tag: '', lane: 'MID' })
    setEditingId(null)
    setAdding(false)
  }
  async function save() {
    setSaving(true)
    setSaveError('')
    try { await onSave(rows.map((row, index) => ({ ...row, order: index }))) } catch (error) { setSaveError(error instanceof Error ? error.message : '사용자 정보를 저장하지 못했습니다.') } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="사용자 관리"><div className="modal"><div className="modal-head"><div><p className="eyebrow">프로젝트 사용자</p><h2>사용자 관리</h2></div><button onClick={onClose} className="icon-button" aria-label="닫기"><X size={20} /></button></div><p className="modal-copy">표시 이름과 Riot 계정 정보를 분리해 관리합니다. 비활성 사용자는 분석 사용자 목록에 표시되지 않습니다. 사용자를 삭제해도 저장된 분석 데이터는 남으며, 같은 Riot ID로 다시 추가하면 그대로 사용할 수 있습니다.</p>
    <div className="user-rows">{rows.map((user, index) => <div className={`user-row ${user.active ? '' : 'inactive'}`} key={user.id}><div className="user-move"><button type="button" onClick={() => move(index, -1)} disabled={isSaving || index === 0} aria-label={`${user.name} 위로 이동`}><ChevronUp size={14} /></button><button type="button" onClick={() => move(index, 1)} disabled={isSaving || index === rows.length - 1} aria-label={`${user.name} 아래로 이동`}><ChevronDown size={14} /></button></div><div className="user-initial">{user.name.slice(0, 1)}</div><div><b>{user.name}</b><p>{user.riotId}<span>#{user.tag}</span> · KR · 기본 {laneLabels[user.lane]}</p></div><button className="user-edit" onClick={() => startEdit(user)} disabled={isSaving} aria-label={`${user.name} 정보 수정`}><Pencil size={14} /> 수정</button><button className="status-button" onClick={() => setRows((current) => current.map((row) => row.id === user.id ? { ...row, active: !row.active } : row))}>{user.active ? '활성' : '비활성'}</button><button className="user-delete" onClick={() => removeUser(user)} disabled={isSaving} aria-label={`${user.name} 사용자 삭제`} title="사용자 삭제"><Trash2 size={14} /></button></div>)}</div>
    {isAdding ? <div className="add-form"><input placeholder="표시 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="Riot ID" value={form.riotId} onChange={(e) => setForm({ ...form, riotId: e.target.value })} /><input placeholder="태그 (예: KR1)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} /><select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value as Lane })}>{(Object.keys(laneLabels) as Lane[]).map((key) => <option key={key} value={key}>{laneLabels[key]}</option>)}</select><button className="primary-button" onClick={saveForm}>{editingId === null ? '추가' : '수정 완료'}</button><button className="ghost-button" onClick={() => { setAdding(false); setEditingId(null); setForm({ name: '', riotId: '', tag: '', lane: 'MID' }) }}>닫기</button></div> : <button className="add-user" onClick={() => { setAdding(true); setEditingId(null) }}><Plus size={17} /> 사용자 추가</button>}
    {saveError && <p className="modal-error"><CircleAlert size={14} /> {saveError}</p>}
    <div className="modal-actions"><button className="ghost-button" onClick={onClose} disabled={isSaving}>취소</button><button className="primary-button" onClick={save} disabled={isSaving}>{isSaving ? '저장 중' : '변경사항 저장'}</button></div>
  </div></div>
}

type SharedDataEntry = { id: string; gameName: string; tagLine: string; championCount: number; syncedAt: string }

function formatDateTime(value: string | null) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '기록 없음'
}

function DataModal({ profiles, onClose, onChanged }: { profiles: Profile[]; onClose: () => void; onChanged: () => void }) {
  const [shared, setShared] = useState<SharedDataEntry[] | null>(null)
  const [local, setLocal] = useState<LocalCacheEntry[] | null>(null)
  const [sharedError, setSharedError] = useState('')
  const [localError, setLocalError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyKey, setBusyKey] = useState('')

  async function load() {
    try {
      const snapshot = await getDocs(summariesCol)
      setShared(snapshot.docs.map((item) => {
        const data = item.data() as Partial<SyncResult>
        return { id: item.id, gameName: data.account?.gameName ?? '', tagLine: data.account?.tagLine ?? '', championCount: data.champions?.length ?? 0, syncedAt: data.syncedAt ?? '' }
      }))
      setSharedError('')
    } catch (error) {
      setSharedError(error instanceof Error ? error.message : '공용 데이터를 불러오지 못했습니다.')
    }
    if (!hasSyncServer) return
    try {
      const response = await fetch(`${syncApiBase}/riot/cache`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '이 PC에 저장된 데이터를 불러오지 못했습니다.')
      setLocal(payload.players)
      setLocalError('')
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : '이 PC에 저장된 데이터를 불러오지 못했습니다.')
    }
  }
  useEffect(() => { void load() }, [])

  function linkedUser(entry: { id?: string; puuid?: string; gameName: string; tagLine: string }) {
    return profiles.find((item) => (entry.id !== undefined && String(item.id) === entry.id) || accountMatchesProfile(item, entry))
  }

  async function remove(key: string, label: string, warning: string, action: () => Promise<void>) {
    if (!window.confirm(`${label} 저장 데이터를 삭제할까요?\n\n${warning}\n삭제한 데이터는 되돌릴 수 없습니다.`)) return
    setBusyKey(key)
    setActionError('')
    try {
      await action()
      await load()
      onChanged()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '저장 데이터를 삭제하지 못했습니다.')
    } finally {
      setBusyKey('')
    }
  }

  async function removeShared(entry: SharedDataEntry) {
    await remove(`shared:${entry.id}`, `'${entry.gameName || '이름 없음'}#${entry.tagLine}'의 공용 Firebase`, '모든 사용자가 보는 분석 결과가 사라집니다. 사용자 정보는 삭제되지 않습니다.', () => deleteDoc(doc(summariesCol, entry.id)))
  }

  async function removeLocal(entry: LocalCacheEntry) {
    await remove(`local:${entry.puuid}`, `'${entry.gameName || '이름 없음'}#${entry.tagLine}'의 이 PC`, `분석 결과와 저장된 경기 ${entry.matchCount}판이 모두 사라지며, 다시 동기화하면 경기를 처음부터 받아야 해서 오래 걸립니다.`, async () => {
      const response = await fetch(`${syncApiBase}/riot/cache/${encodeURIComponent(entry.puuid)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '이 PC의 저장 데이터를 삭제하지 못했습니다.')
    })
  }

  function UserTag({ user }: { user?: Profile }) {
    return user ? <span className="link-tag linked">사용자: {user.name}</span> : <span className="link-tag">연결된 사용자 없음</span>
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="저장 데이터 관리"><div className="modal"><div className="modal-head"><div><p className="eyebrow">분석 결과 저장소</p><h2>저장 데이터 관리</h2></div><button onClick={onClose} className="icon-button" aria-label="닫기"><X size={20} /></button></div>
    <p className="modal-copy">저장된 분석 데이터가 어떤 Riot 계정의 것인지 확인하고 삭제합니다. 사용자 삭제와는 별개이며, 데이터가 남아 있으면 같은 Riot ID의 사용자를 다시 추가할 때 그대로 연결됩니다.</p>
    <section className="data-section"><h3>공용 Firebase 데이터 <small>{shared ? `${shared.length}개` : ''}</small></h3>
      {sharedError && <p className="modal-error"><CircleAlert size={14} /> {sharedError}</p>}
      {shared && !shared.length && <p className="data-empty">저장된 공용 데이터가 없습니다.</p>}
      <div className="user-rows">{shared?.map((entry) => <div className="user-row" key={entry.id}><div className="user-initial">{(entry.gameName || '?').slice(0, 1)}</div><div><b>{entry.gameName || '이름 없음'}<span className="tag-suffix">#{entry.tagLine}</span></b><p>챔피언 {entry.championCount}개 · 마지막 동기화 {formatDateTime(entry.syncedAt)}</p><UserTag user={linkedUser(entry)} /></div><button className="user-delete with-label" onClick={() => void removeShared(entry)} disabled={busyKey !== ''}><Trash2 size={14} /> {busyKey === `shared:${entry.id}` ? '삭제 중' : '삭제'}</button></div>)}</div>
    </section>
    {hasSyncServer && <section className="data-section"><h3>이 PC 서버 데이터 <small>{local ? `${local.length}개` : ''}</small></h3>
      {localError && <p className="modal-error"><CircleAlert size={14} /> {localError}</p>}
      {local && !local.length && <p className="data-empty">이 PC에 저장된 데이터가 없습니다.</p>}
      <div className="user-rows">{local?.map((entry) => <div className="user-row" key={entry.puuid}><div className="user-initial">{(entry.gameName || '?').slice(0, 1)}</div><div><b>{entry.gameName || '이름 없음'}<span className="tag-suffix">#{entry.tagLine}</span></b><p>저장된 경기 {entry.matchCount}판 · {entry.hasSummary ? `분석 결과 있음 · 마지막 동기화 ${formatDateTime(entry.syncedAt)}` : '분석 결과 없음'}</p><UserTag user={linkedUser(entry)} /></div><button className="user-delete with-label" onClick={() => void removeLocal(entry)} disabled={busyKey !== ''}><Trash2 size={14} /> {busyKey === `local:${entry.puuid}` ? '삭제 중' : '삭제'}</button></div>)}</div>
    </section>}
    {actionError && <p className="modal-error"><CircleAlert size={14} /> {actionError}</p>}
    <div className="modal-actions"><button className="ghost-button" onClick={onClose}>닫기</button></div>
  </div></div>
}
