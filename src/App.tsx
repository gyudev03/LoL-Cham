import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import {
  Check, ChevronDown, CircleAlert, Flame, Gauge, Plus, RefreshCw,
  Pencil, Search, Settings2, ShieldAlert, Sparkles, Swords, Trash2, Trophy, Users, X, LogIn, LogOut, Upload,
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
  metrics: { label: string; value: string; tone: 'good' | 'neutral' | 'warn' }[]
}

type SyncResult = {
  champions: Champion[]
  account: { puuid: string; gameName: string; tagLine: string }
  syncedAt: string
}

const sharedProfiles = collection(db, 'shared', 'chamlog', 'profiles')
const summaryRef = (profileId: number) => doc(db, 'shared', 'chamlog', 'summaries', String(profileId))
const syncApiBase = import.meta.env.VITE_SYNC_API_URL || '/api'
const hasSyncServer = window.location.hostname === 'localhost' || Boolean(import.meta.env.VITE_SYNC_API_URL)

const laneLabels: Record<Lane, string> = {
  TOP: '탑', JUNGLE: '정글', MID: '미드', BOTTOM: '원딜', SUPPORT: '서포터',
}

const championImage = (id: string) => `https://ddragon.leagueoflegends.com/cdn/15.20.1/img/champion/${id}.png`

const mockChampions: Champion[] = [
  {
    id: 'Ahri', name: '아리', lane: 'MID', image: championImage('Ahri'), tier: 'A', mastery: 278450, masteryLevel: 7,
    aiScore: 78, winRate: 60, games: 20, lastPlayed: '7일 전', runes: ['감전', '궁극의 사냥꾼', '침착', '최후의 일격'],
    counters: { good: ['신드라', '르블랑'], difficult: ['카사딘', '피즈'] },
    strengths: ['데스 관리가 안정적입니다.', '로밍 및 킬 관여가 좋습니다.'],
    improvements: ['15분 이전 CS 수급을 보완해 보세요.', '최근 플레이 간격이 다소 깁니다.'],
    metrics: [{ label: '라인전 안정성', value: '상', tone: 'good' }, { label: '로밍 관여', value: '상', tone: 'good' }, { label: '초반 CS 수급', value: '보완 필요', tone: 'warn' }],
  },
  {
    id: 'Syndra', name: '신드라', lane: 'MID', image: championImage('Syndra'), tier: 'A', mastery: 102330, masteryLevel: 7,
    aiScore: 68, winRate: 54, games: 13, lastPlayed: '2일 전', runes: ['난입', '빛의 망토', '비스킷 배달', '우주적 통찰력'],
    counters: { good: ['오리아나', '카시오페아'], difficult: ['피즈', '르블랑'] },
    strengths: ['교전 피해 기여도가 좋습니다.', '최근 플레이 감각이 유지되고 있습니다.'],
    improvements: ['시야 확보 타이밍을 더 의식해 보세요.'],
    metrics: [{ label: '교전 기여', value: '상', tone: 'good' }, { label: '최근 플레이', value: '양호', tone: 'good' }, { label: '시야 관리', value: '보통', tone: 'neutral' }],
  },
  {
    id: 'Orianna', name: '오리아나', lane: 'MID', image: championImage('Orianna'), tier: 'B', mastery: 54820, masteryLevel: 6,
    aiScore: 59, winRate: 50, games: 8, lastPlayed: '18일 전', runes: ['콩콩이 소환', '마나순환 팔찌', '비스킷 배달', '시간 왜곡 물약'],
    counters: { good: ['탈론', '아칼리'], difficult: ['신드라', '제라스'] },
    strengths: ['한타 위치 선정이 안정적입니다.'],
    improvements: ['플레이 표본이 적습니다.', '최근 플레이를 통해 감각을 확인해 보세요.'],
    metrics: [{ label: '한타 기여', value: '양호', tone: 'good' }, { label: '최근 플레이', value: '낮음', tone: 'warn' }, { label: '분석 신뢰도', value: '낮음', tone: 'warn' }],
  },
  {
    id: 'Aatrox', name: '아트록스', lane: 'TOP', image: championImage('Aatrox'), tier: 'A', mastery: 151040, masteryLevel: 7,
    aiScore: 73, winRate: 57, games: 18, lastPlayed: '4일 전', runes: ['정복자', '승전보', '뼈 방패', '불굴의 의지'],
    counters: { good: ['나서스', '사이온'], difficult: ['피오라', '이렐리아'] },
    strengths: ['라인 유지력이 안정적입니다.'], improvements: ['텔레포트 활용을 더 점검해 보세요.'],
    metrics: [{ label: '라인전 안정성', value: '상', tone: 'good' }, { label: '교전 기여', value: '양호', tone: 'good' }, { label: '사이드 운영', value: '보통', tone: 'neutral' }],
  },
  {
    id: 'LeeSin', name: '리 신', lane: 'JUNGLE', image: championImage('LeeSin'), tier: 'A', mastery: 210210, masteryLevel: 7,
    aiScore: 76, winRate: 56, games: 25, lastPlayed: '1일 전', runes: ['정복자', '승전보', '마법의 신발', '우주적 통찰력'],
    counters: { good: ['카서스', '킨드레드'], difficult: ['람머스', '볼리베어'] },
    strengths: ['초반 오브젝트 관여가 높습니다.'], improvements: ['후반 시야 확보를 보완해 보세요.'],
    metrics: [{ label: '오브젝트 관여', value: '상', tone: 'good' }, { label: '초반 압박', value: '상', tone: 'good' }, { label: '후반 시야', value: '보통', tone: 'neutral' }],
  },
  {
    id: 'Jinx', name: '징크스', lane: 'BOTTOM', image: championImage('Jinx'), tier: 'S', mastery: 87620, masteryLevel: 6,
    aiScore: 71, winRate: 58, games: 17, lastPlayed: '3일 전', runes: ['치명적 속도', '침착', '마법의 신발', '비스킷 배달'],
    counters: { good: ['베인', '칼리스타'], difficult: ['드레이븐', '사미라'] },
    strengths: ['한타 피해 기여가 좋습니다.'], improvements: ['초반 라인전 위치를 보완해 보세요.'],
    metrics: [{ label: '한타 기여', value: '상', tone: 'good' }, { label: '데스 관리', value: '양호', tone: 'good' }, { label: '초반 라인전', value: '보통', tone: 'neutral' }],
  },
  {
    id: 'Thresh', name: '쓰레쉬', lane: 'SUPPORT', image: championImage('Thresh'), tier: 'A', mastery: 190730, masteryLevel: 7,
    aiScore: 74, winRate: 55, games: 21, lastPlayed: '5일 전', runes: ['여진', '생명의 샘', '비스킷 배달', '우주적 통찰력'],
    counters: { good: ['블리츠크랭크', '노틸러스'], difficult: ['잔나', '밀리오'] },
    strengths: ['시야와 교전 설계가 안정적입니다.'], improvements: ['라인 주도권 판단을 보완해 보세요.'],
    metrics: [{ label: '시야 관리', value: '상', tone: 'good' }, { label: '교전 설계', value: '상', tone: 'good' }, { label: '라인 주도권', value: '보통', tone: 'neutral' }],
  },
]

const initialProfiles: Profile[] = [
  { id: 1, name: '홍길동', riotId: 'Hide on bush', tag: 'KR1', lane: 'MID', active: true, syncedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  { id: 2, name: '김소환', riotId: 'Summoner Kim', tag: 'KR2', lane: 'JUNGLE', active: true, syncedAt: new Date(Date.now() - 28 * 60 * 60 * 1000) },
]

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

function tierClass(tier: Champion['tier']) { return `tier tier-${tier.toLowerCase()}` }
function championEntryId(champion: Champion) { return champion.entryId ?? champion.id }
function aiGrade(score: number | null) {
  if (score === null) return '데이터 부족'
  if (score >= 80) return '매우 숙련'
  if (score >= 65) return '안정적'
  if (score >= 50) return '보통'
  return '보완 필요'
}

function profileFromStorage(item: Omit<Profile, 'syncedAt'> & { syncedAt?: string | Date }) {
  return { ...item, syncedAt: item.syncedAt ? new Date(item.syncedAt) : new Date(0) }
}

function profileForStorage(item: Profile) {
  return { ...item, syncedAt: item.syncedAt.toISOString() }
}

export default function App() {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [profileId, setProfileId] = useState<number | null>(null)
  const [lane, setLane] = useState<Lane>('MID')
  const [selectedId, setSelectedId] = useState('')
  const [championData, setChampionData] = useState<Champion[]>([])
  const [sortBy, setSortBy] = useState<'ai' | 'mastery' | 'win'>('ai')
  const [isUserModalOpen, setUserModalOpen] = useState(false)
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

  const laneChampions = useMemo(() => championData
    .filter((champion) => champion.lane === lane && champion.name.includes(query.trim()))
    .sort((a, b) => sortBy === 'mastery' ? b.mastery - a.mastery : sortBy === 'win' ? (b.winRate ?? 0) - (a.winRate ?? 0) : (b.aiScore ?? 0) - (a.aiScore ?? 0)), [lane, query, sortBy])

  function switchLane(nextLane: Lane) {
    setLane(nextLane)
    const first = championData.find((champion) => champion.lane === nextLane)
    if (first) setSelectedId(championEntryId(first))
  }

  async function loadCachedData(targetProfile: Profile) {
    setSyncError('')
    setChampionData([])
    setSelectedId('')
    setLiveData(false)
    try {
      const sharedSummary = await getDoc(summaryRef(targetProfile.id))
      let payload = sharedSummary.exists() ? sharedSummary.data() as SyncResult : null
      setSharedData(sharedSummary.exists())
      setLocalOnlyData(false)
      if (!payload && targetProfile.puuid) {
        const response = await fetch(`${syncApiBase}/riot/summary/${encodeURIComponent(targetProfile.puuid)}`)
        if (response.ok) {
          payload = await response.json() as SyncResult
          setLocalOnlyData(true)
        } else if (response.status !== 404) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body.message || '저장된 분석 데이터를 불러오지 못했습니다.')
        }
      }
      if (!payload?.champions?.length) return
      setChampionData(payload.champions)
      setLiveData(true)
      const preferred = payload.champions.find((champion: Champion) => champion.lane === targetProfile.lane) ?? payload.champions[0]
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
      setProfiles((current) => {
        const nextProfiles = current.map((item) => item.id === targetProfile.id ? { ...item, riotId: result.account.gameName, tag: result.account.tagLine, puuid: result.account.puuid, syncedAt: new Date(result.syncedAt) } : item)
        void persistProfiles(nextProfiles)
          .then(() => setDoc(summaryRef(targetProfile.id), result))
          .then(() => { setSharedData(true); setLocalOnlyData(false) })
          .catch((error) => setProfileError(error instanceof Error ? error.message : '공유 데이터를 저장하지 못했습니다.'))
        return nextProfiles
      })
      const preferred = result.champions.find((champion: Champion) => champion.lane === lane) ?? result.champions[0]
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
    const removed = profiles.filter((item) => !nextProfiles.some((next) => next.id === item.id))
    await persistProfiles(nextProfiles)
    // 삭제된 사용자의 공용 프로필과 분석 결과를 Firebase에서 함께 제거한다. 관리자 PC의 로컬 캐시(data/)는 건드리지 않는다.
    await Promise.all(removed.flatMap((item) => [deleteDoc(doc(sharedProfiles, String(item.id))), deleteDoc(summaryRef(item.id))]))
    if (removed.length && hasSyncServer) {
      // 로컬 서버의 users.json 목록도 맞춰 두어, 공용 데이터가 비었을 때 삭제한 사용자가 다시 나타나지 않게 한다.
      await fetch(`${syncApiBase}/users`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ users: nextProfiles.map(profileForStorage) }) }).catch(() => undefined)
    }
    setProfiles(nextProfiles)
    const nextActive = nextProfiles.find((item) => item.id === profileId && item.active) ?? nextProfiles.find((item) => item.active)
    if (nextActive) { setProfileId(nextActive.id); setLane(nextActive.lane); void loadCachedData(nextActive) }
    else if (removed.some((item) => item.id === profileId)) {
      setProfileId(null)
      setChampionData([])
      setSelectedId('')
      setLiveData(false)
      setSharedData(false)
      setLocalOnlyData(false)
    }
    setUserModalOpen(false)
  }

  async function publishLocalData() {
    if (!profile || !isAdmin || !championData.length) return
    try {
      await persistProfiles(profiles)
      await setDoc(summaryRef(profile.id), {
        account: { puuid: profile.puuid || '', gameName: profile.riotId, tagLine: profile.tag },
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

  async function waitForSync(jobId: string): Promise<{ champions: Champion[]; account: { puuid: string; gameName: string; tagLine: string }; syncedAt: string }> {
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
    return <main className="app-shell"><header className="topbar"><a className="brand" href="#top"><span>CHAM</span>LOG <i /></a><ManagerButton user={authUser} isAdmin={isAdmin} busy={authBusy} onSignIn={signInAsManager} onSignOut={signOutManager} /></header><section className="empty-onboarding"><Users size={34} /><p className="eyebrow">분석 사용자 없음</p><h1>먼저 분석할<br /><em>사용자</em>를 등록하세요.</h1><p>{isAdmin ? 'Riot ID, 태그, 기본 라인을 저장한 뒤 데이터 새로고침을 눌러 첫 동기화를 진행하세요.' : '공용 분석 데이터가 아직 없습니다. 관리자가 로그인해 사용자를 추가할 수 있습니다.'}</p>{isAdmin && <button className="primary-button" onClick={() => setUserModalOpen(true)}><Plus size={17} /> 사용자 추가</button>}</section>{isUserModalOpen && isAdmin && <UserModal profiles={profiles} onClose={() => setUserModalOpen(false)} onSave={saveUserProfiles} />}</main>
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Chamlog 홈"><span>CHAM</span>LOG <i /></a>
        <div className="header-actions">
          {isAdmin && <button className="ghost-button" onClick={() => setUserModalOpen(true)}><Users size={17} /> 사용자 관리</button>}
          <ManagerButton user={authUser} isAdmin={isAdmin} busy={authBusy} onSignIn={signInAsManager} onSignOut={signOutManager} />
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy"><p className="eyebrow"><Sparkles size={14} /> 개인 챔피언 분석</p><h1>내 플레이를 <em>이해하는</em><br />챔피언 기록</h1><p>챔피언 선택은 당신의 몫입니다. Chamlog는 선택한 챔피언의 숙련도와 개선점을 보여줍니다.</p></div>
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
        {isAdmin && <button className="profile-edit" onClick={() => setUserModalOpen(true)}><Settings2 size={16} /> 사용자 정보 관리</button>}
      </section>

      <nav className="lane-tabs" aria-label="라인 선택">
        {(Object.keys(laneLabels) as Lane[]).map((key) => <button key={key} className={lane === key ? 'active' : ''} onClick={() => switchLane(key)}>{laneLabels[key]}{profile.lane === key && <span>기본</span>}</button>)}
      </nav>

      <section className="workspace">
        <div className="champion-panel panel">
          <div className="panel-heading"><div><p className="eyebrow">{laneLabels[lane]} 챔피언</p><h2>챔피언 목록 <small>{laneChampions.length}</small></h2></div><div className="filter-row"><label className="search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="챔피언 검색" /></label><select aria-label="정렬" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}><option value="ai">AI 숙련도순</option><option value="mastery">공식 숙련도순</option><option value="win">최근 승률순</option></select></div></div>
          <p className="data-notice"><CircleAlert size={14} /> {isLiveData ? `${isSharedData ? '공용 Firebase' : '현재 PC'}에 저장된 이번 시즌 솔로·자유랭크 분석 데이터입니다.${isAdmin ? ' 새 게임 반영은 관리자만 할 수 있습니다.' : ''}` : '저장된 분석 데이터가 없습니다. 관리자에게 동기화를 요청하세요.'}</p>
          <div className="table-head"><span>챔피언</span><span>공식 숙련도</span><span>AI 숙련도</span><span>최근 승률</span><span>메타</span></div>
          <div className="champion-list">
            {laneChampions.map((champion) => <button key={championEntryId(champion)} className={`champion-row ${selectedId === championEntryId(champion) ? 'selected' : ''}`} onClick={() => setSelectedId(championEntryId(champion))}>
              <span className="champion-name"><img src={champion.image} alt="" /><b>{champion.name}</b></span>
              <span><b>{champion.masteryLevel}레벨</b><small>{formatMastery(champion.mastery)}점</small></span>
              <span className="score"><b>{champion.aiScore ?? '—'}</b><small>{champion.analysisNote ? `표본 적음 · ${aiGrade(champion.aiScore)}` : aiGrade(champion.aiScore)}</small></span>
              <span><b>{champion.winRate ? `${champion.winRate}%` : '—'}</b><small>{champion.games}게임</small></span>
              <span className={tierClass(champion.tier)}>{champion.tier}</span>
            </button>)}
            {!laneChampions.length && <div className="empty">검색 결과가 없습니다.</div>}
          </div>
        </div>

        {selected ? <aside className="detail-panel panel">
          <div className="detail-title"><img src={selected.image} alt="" /><div><p className="eyebrow">{laneLabels[selected.lane]}</p><h2>{selected.name}</h2></div><span className={tierClass(selected.tier)}>{selected.tier}<small>메타 티어</small></span></div>
          <DetailBlock icon={<Swords size={17} />} title="카운터"><div className="counter-grid"><CounterList label="상대하기 좋은 챔피언" values={selected.counters.good} type="good" /><CounterList label="상대하기 어려운 챔피언" values={selected.counters.difficult} type="difficult" /></div></DetailBlock>
          <DetailBlock icon={<Sparkles size={17} />} title="룬 정보">
            {selected.runeInfo ? <RuneInfo info={selected.runeInfo} /> : <div className="runes">{(selected.runes || ['룬 정보를 찾지 못했습니다.']).map((rune, index) => <span key={rune} className={index === 0 ? 'keystone' : ''}>{rune}</span>)}</div>}
            <small className="source-note">{isLiveData ? '이번 시즌 해당 라인에서 가장 많이 사용한 룬 조합입니다. 룬 명칭은 Riot Data Dragon 기준입니다.' : 'Riot API 연동 후 최근 전적 기반 룬 정보로 바뀝니다.'}</small>
          </DetailBlock>
          <DetailBlock icon={<Trophy size={17} />} title="공식 숙련도"><div className="mastery-stat"><div><strong>{selected.masteryLevel}</strong><span>레벨</span></div><div><b>{formatMastery(selected.mastery)}점</b><small>챔피언 숙련도 점수</small></div><div><b>{selected.games}회</b><small>{isLiveData ? '시즌 분석 게임' : '최근 분석 게임'}</small></div></div></DetailBlock>
          <DetailBlock icon={<Gauge size={17} />} title="AI 숙련도"><div className="ai-summary"><div className="score-ring" style={{ '--score': `${selected.aiScore ?? 0}%` } as CSSProperties}><b>{selected.aiScore ?? '—'}</b><small>점</small></div><div><strong>{aiGrade(selected.aiScore)}</strong><p>최근 승률 {selected.winRate ?? '—'}% · 최근 플레이 {selected.lastPlayed}</p><div className="metric-tags">{selected.metrics.map((metric) => <span className={metric.tone} key={metric.label}>{metric.label} <b>{metric.value}</b></span>)}</div></div></div>
            {selected.analysisNote && <p className="analysis-note"><CircleAlert size={13} /> {selected.analysisNote}</p>}
            <div className="insight-grid"><Insight title="강점" icon={<Check size={15} />} values={selected.strengths} tone="good" /><Insight title="개선할 점" icon={<Flame size={15} />} values={selected.improvements} tone="warn" /></div>
          </DetailBlock>
        </aside> : <aside className="detail-panel panel detail-empty"><Gauge size={28} /><h2>{isSyncing ? '시즌 전적을 분석하고 있습니다' : '챔피언을 기다리고 있습니다'}</h2><p>{isSyncing ? '동기화가 끝나면 실제 플레이한 챔피언이 표시됩니다.' : '새로고침으로 해당 사용자의 챔피언 데이터를 불러오세요.'}</p></aside>}
      </section>

      {isUserModalOpen && isAdmin && <UserModal profiles={profiles} onClose={() => setUserModalOpen(false)} onSave={saveUserProfiles} />}
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

function CounterList({ label, values, type }: { label: string; values: string[]; type: 'good' | 'difficult' }) {
  return <div className={`counter-list ${type}`}><small>{type === 'good' ? <Check size={13} /> : <ShieldAlert size={13} />}{label}</small><div>{values.map((name) => <span key={name}>{name}</span>)}</div></div>
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

function UserModal({ profiles, onClose, onSave }: { profiles: Profile[]; onClose: () => void; onSave: (profiles: Profile[]) => Promise<void> }) {
  const [rows, setRows] = useState(profiles)
  const [isAdding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', riotId: '', tag: '', lane: 'MID' as Lane })
  const [isSaving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  function removeUser(id: number) {
    setRows((current) => current.filter((user) => user.id !== id))
    setConfirmDeleteId(null)
    if (editingId === id) { setAdding(false); setEditingId(null); setForm({ name: '', riotId: '', tag: '', lane: 'MID' }) }
  }
  function startEdit(user: Profile) {
    setForm({ name: user.name, riotId: user.riotId, tag: user.tag, lane: user.lane })
    setEditingId(user.id)
    setAdding(true)
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
    try { await onSave(rows) } catch (error) { setSaveError(error instanceof Error ? error.message : '사용자 정보를 저장하지 못했습니다.') } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="사용자 관리"><div className="modal"><div className="modal-head"><div><p className="eyebrow">프로젝트 사용자</p><h2>사용자 관리</h2></div><button onClick={onClose} className="icon-button" aria-label="닫기"><X size={20} /></button></div><p className="modal-copy">표시 이름과 Riot 계정 정보를 분리해 관리합니다. 비활성 사용자는 분석 사용자 목록에 표시되지 않습니다. 삭제한 사용자는 &lsquo;변경사항 저장&rsquo;을 누르면 공용 분석 데이터까지 함께 지워지며 되돌릴 수 없습니다. 잠시 숨기려면 삭제 대신 비활성으로 바꾸세요.</p>
    <div className="user-rows">{rows.map((user) => <div className={`user-row ${user.active ? '' : 'inactive'}`} key={user.id}><div className="user-initial">{user.name.slice(0, 1)}</div><div><b>{user.name}</b><p>{user.riotId}<span>#{user.tag}</span> · KR · 기본 {laneLabels[user.lane]}</p></div><button className="user-edit" onClick={() => startEdit(user)} disabled={isSaving} aria-label={`${user.name} 정보 수정`}><Pencil size={14} /> 수정</button><button className="status-button" onClick={() => setRows((current) => current.map((row) => row.id === user.id ? { ...row, active: !row.active } : row))}>{user.active ? '활성' : '비활성'}</button>{confirmDeleteId === user.id ? <><button className="user-delete confirm" onClick={() => removeUser(user.id)} disabled={isSaving}>삭제 확인</button><button className="user-edit" onClick={() => setConfirmDeleteId(null)} disabled={isSaving}>취소</button></> : <button className="user-delete" onClick={() => setConfirmDeleteId(user.id)} disabled={isSaving} aria-label={`${user.name} 삭제`}><Trash2 size={14} /> 삭제</button>}</div>)}</div>
    {isAdding ? <div className="add-form"><input placeholder="표시 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="Riot ID" value={form.riotId} onChange={(e) => setForm({ ...form, riotId: e.target.value })} /><input placeholder="태그 (예: KR1)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} /><select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value as Lane })}>{(Object.keys(laneLabels) as Lane[]).map((key) => <option key={key} value={key}>{laneLabels[key]}</option>)}</select><button className="primary-button" onClick={saveForm}>{editingId === null ? '추가' : '수정 완료'}</button><button className="ghost-button" onClick={() => { setAdding(false); setEditingId(null); setForm({ name: '', riotId: '', tag: '', lane: 'MID' }) }}>닫기</button></div> : <button className="add-user" onClick={() => { setAdding(true); setEditingId(null) }}><Plus size={17} /> 사용자 추가</button>}
    {saveError && <p className="modal-error"><CircleAlert size={14} /> {saveError}</p>}
    <div className="modal-actions"><button className="ghost-button" onClick={onClose} disabled={isSaving}>취소</button><button className="primary-button" onClick={save} disabled={isSaving}>{isSaving ? '저장 중' : '변경사항 저장'}</button></div>
  </div></div>
}
