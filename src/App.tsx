import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Check, ChevronDown, CircleAlert, Flame, Gauge, Plus, RefreshCw,
  Search, Settings2, ShieldAlert, Sparkles, Swords, Trophy, Users, X,
} from 'lucide-react'

type Lane = 'TOP' | 'JUNGLE' | 'MID' | 'BOTTOM' | 'SUPPORT'

type Profile = {
  id: number
  name: string
  riotId: string
  tag: string
  lane: Lane
  active: boolean
  syncedAt: Date
}

type Champion = {
  id: string
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
  runes: string[]
  counters: { good: string[]; difficult: string[] }
  strengths: string[]
  improvements: string[]
  metrics: { label: string; value: string; tone: 'good' | 'neutral' | 'warn' }[]
}

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
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3600000))
  return hours === 0 ? '방금 전' : `${hours}시간 전`
}

function tierClass(tier: Champion['tier']) { return `tier tier-${tier.toLowerCase()}` }

export default function App() {
  const [profiles, setProfiles] = useState(initialProfiles)
  const [profileId, setProfileId] = useState(1)
  const [lane, setLane] = useState<Lane>('MID')
  const [selectedId, setSelectedId] = useState('Ahri')
  const [championData, setChampionData] = useState<Champion[]>(mockChampions)
  const [sortBy, setSortBy] = useState<'ai' | 'mastery' | 'win'>('ai')
  const [isUserModalOpen, setUserModalOpen] = useState(false)
  const [isSyncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [isLiveData, setLiveData] = useState(false)
  const [query, setQuery] = useState('')
  const profile = profiles.find((item) => item.id === profileId)!
  const selected = championData.find((item) => item.id === selectedId) ?? championData[0] ?? mockChampions[0]

  const laneChampions = useMemo(() => championData
    .filter((champion) => champion.lane === lane && champion.name.includes(query.trim()))
    .sort((a, b) => sortBy === 'mastery' ? b.mastery - a.mastery : sortBy === 'win' ? (b.winRate ?? 0) - (a.winRate ?? 0) : (b.aiScore ?? 0) - (a.aiScore ?? 0)), [lane, query, sortBy])

  function switchLane(nextLane: Lane) {
    setLane(nextLane)
    const first = championData.find((champion) => champion.lane === nextLane)
    if (first) setSelectedId(first.id)
  }

  async function refreshData() {
    setSyncing(true)
    setSyncError('')
    try {
      const params = new URLSearchParams({ gameName: profile.riotId, tagLine: profile.tag })
      const response = await fetch(`/api/riot/sync?${params}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message || '동기화 중 오류가 발생했습니다.')
      if (!payload.champions.length) throw new Error('최근 30게임에서 분석 가능한 솔로·자유랭크 전적을 찾지 못했습니다.')
      setChampionData(payload.champions)
      setLiveData(true)
      setProfiles((current) => current.map((item) => item.id === profileId ? { ...item, riotId: payload.account.gameName, tag: payload.account.tagLine, syncedAt: new Date(payload.syncedAt) } : item))
      const preferred = payload.champions.find((champion: Champion) => champion.lane === lane) ?? payload.champions[0]
      setLane(preferred.lane)
      setSelectedId(preferred.id)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Chamlog 홈"><span>CHAM</span>LOG <i /></a>
        <div className="header-actions">
          <button className="ghost-button" onClick={() => setUserModalOpen(true)}><Users size={17} /> 사용자 관리</button>
          <button className="avatar" onClick={() => setUserModalOpen(true)} aria-label="사용자 설정">홍</button>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy"><p className="eyebrow"><Sparkles size={14} /> 개인 챔피언 분석</p><h1>내 플레이를 <em>이해하는</em><br />챔피언 기록</h1><p>챔피언 선택은 당신의 몫입니다. Chamlog는 선택한 챔피언의 숙련도와 개선점을 보여줍니다.</p></div>
        <div className="sync-card">
          <div><p>데이터 상태</p><strong><span className={`status-dot ${syncError ? 'error' : ''}`} /> {syncError ? '동기화 오류' : isLiveData ? 'Riot API 동기화 완료' : '예시 데이터'}</strong><small>마지막 동기화: {syncAge(profile.syncedAt)}</small></div>
          <button className="refresh-button" disabled={isSyncing} onClick={refreshData}>{isSyncing ? <RefreshCw className="spin" size={16} /> : <RefreshCw size={16} />}{isSyncing ? '동기화 중' : '데이터 새로고침'}</button>
        </div>
      </section>
      {syncError && <p className="sync-error"><CircleAlert size={15} /> {syncError}</p>}

      <section className="profile-bar">
        <div className="profile-select-wrap">
          <label>분석 사용자</label>
          <div className="select-with-icon"><Users size={16} /><select value={profileId} onChange={(event) => { const id = Number(event.target.value); const next = profiles.find((p) => p.id === id)!; setProfileId(id); switchLane(next.lane) }}>
            {profiles.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.riotId}#{item.tag}</option>)}
          </select><ChevronDown size={16} /></div>
        </div>
        <div className="profile-info"><div className="rank-emblem"><Trophy size={20} /></div><div><strong>{profile.riotId}<span>#{profile.tag}</span></strong><p>KR 서버 · 기본 라인 <b>{laneLabels[profile.lane]}</b></p></div></div>
        <button className="profile-edit" onClick={() => setUserModalOpen(true)}><Settings2 size={16} /> 사용자 정보 관리</button>
      </section>

      <nav className="lane-tabs" aria-label="라인 선택">
        {(Object.keys(laneLabels) as Lane[]).map((key) => <button key={key} className={lane === key ? 'active' : ''} onClick={() => switchLane(key)}>{laneLabels[key]}{profile.lane === key && <span>기본</span>}</button>)}
      </nav>

      <section className="workspace">
        <div className="champion-panel panel">
          <div className="panel-heading"><div><p className="eyebrow">{laneLabels[lane]} 챔피언</p><h2>챔피언 목록 <small>{laneChampions.length}</small></h2></div><div className="filter-row"><label className="search"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="챔피언 검색" /></label><select aria-label="정렬" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}><option value="ai">AI 숙련도순</option><option value="mastery">공식 숙련도순</option><option value="win">최근 승률순</option></select></div></div>
          <p className="data-notice"><CircleAlert size={14} /> {isLiveData ? '공식 숙련도와 최근 솔로·자유랭크 30게임으로 분석한 데이터입니다. 메타·카운터·룬은 아직 외부 데이터 연동 전입니다.' : '현재 분석 값은 화면 검증용 예시 데이터입니다. Riot API 키 설정 후 새로고침하면 실제 데이터로 바뀝니다.'}</p>
          <div className="table-head"><span>챔피언</span><span>공식 숙련도</span><span>AI 숙련도</span><span>최근 승률</span><span>메타</span></div>
          <div className="champion-list">
            {laneChampions.map((champion) => <button key={champion.id} className={`champion-row ${selectedId === champion.id ? 'selected' : ''}`} onClick={() => setSelectedId(champion.id)}>
              <span className="champion-name"><img src={champion.image} alt="" /><b>{champion.name}</b></span>
              <span><b>{champion.masteryLevel}레벨</b><small>{formatMastery(champion.mastery)}점</small></span>
              <span className="score"><b>{champion.aiScore ?? '—'}</b><small>{champion.aiScore ? '안정적' : '데이터 부족'}</small></span>
              <span><b>{champion.winRate ? `${champion.winRate}%` : '—'}</b><small>{champion.games}게임</small></span>
              <span className={tierClass(champion.tier)}>{champion.tier}</span>
            </button>)}
            {!laneChampions.length && <div className="empty">검색 결과가 없습니다.</div>}
          </div>
        </div>

        <aside className="detail-panel panel">
          <div className="detail-title"><img src={selected.image} alt="" /><div><p className="eyebrow">{laneLabels[selected.lane]}</p><h2>{selected.name}</h2></div><span className={tierClass(selected.tier)}>{selected.tier}<small>메타 티어</small></span></div>
          <DetailBlock icon={<Swords size={17} />} title="카운터"><div className="counter-grid"><CounterList label="상대하기 좋은 챔피언" values={selected.counters.good} type="good" /><CounterList label="상대하기 어려운 챔피언" values={selected.counters.difficult} type="difficult" /></div></DetailBlock>
          <DetailBlock icon={<Sparkles size={17} />} title="룬 정보"><div className="runes">{selected.runes.map((rune, index) => <span key={rune} className={index === 0 ? 'keystone' : ''}>{rune}</span>)}</div><small className="source-note">메타·카운터·룬은 향후 허용된 외부 데이터 소스와 연결됩니다.</small></DetailBlock>
          <DetailBlock icon={<Trophy size={17} />} title="공식 숙련도"><div className="mastery-stat"><div><strong>{selected.masteryLevel}</strong><span>레벨</span></div><div><b>{formatMastery(selected.mastery)}점</b><small>챔피언 숙련도 점수</small></div><div><b>{selected.games}회</b><small>최근 분석 게임</small></div></div></DetailBlock>
          <DetailBlock icon={<Gauge size={17} />} title="AI 숙련도"><div className="ai-summary"><div className="score-ring" style={{ '--score': `${selected.aiScore ?? 0}%` } as CSSProperties}><b>{selected.aiScore ?? '—'}</b><small>점</small></div><div><strong>{selected.aiScore && selected.aiScore >= 75 ? '안정적' : '보완 필요'}</strong><p>최근 승률 {selected.winRate ?? '—'}% · 최근 플레이 {selected.lastPlayed}</p><div className="metric-tags">{selected.metrics.map((metric) => <span className={metric.tone} key={metric.label}>{metric.label} <b>{metric.value}</b></span>)}</div></div></div>
            <div className="insight-grid"><Insight title="강점" icon={<Check size={15} />} values={selected.strengths} tone="good" /><Insight title="개선할 점" icon={<Flame size={15} />} values={selected.improvements} tone="warn" /></div>
          </DetailBlock>
        </aside>
      </section>

      {isUserModalOpen && <UserModal profiles={profiles} onClose={() => setUserModalOpen(false)} onSave={(next) => { setProfiles(next); setUserModalOpen(false) }} />}
    </main>
  )
}

function DetailBlock({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <section className="detail-block"><h3>{icon}{title}</h3>{children}</section>
}

function CounterList({ label, values, type }: { label: string; values: string[]; type: 'good' | 'difficult' }) {
  return <div className={`counter-list ${type}`}><small>{type === 'good' ? <Check size={13} /> : <ShieldAlert size={13} />}{label}</small><div>{values.map((name) => <span key={name}>{name}</span>)}</div></div>
}

function Insight({ title, icon, values, tone }: { title: string; icon: ReactNode; values: string[]; tone: 'good' | 'warn' }) {
  return <div className={`insight ${tone}`}><strong>{icon}{title}</strong>{values.map((value) => <p key={value}>{value}</p>)}</div>
}

function UserModal({ profiles, onClose, onSave }: { profiles: Profile[]; onClose: () => void; onSave: (profiles: Profile[]) => void }) {
  const [rows, setRows] = useState(profiles)
  const [isAdding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', riotId: '', tag: '', lane: 'MID' as Lane })
  function addUser() {
    if (!form.name.trim() || !form.riotId.trim() || !form.tag.trim()) return
    setRows((current) => [...current, { id: Date.now(), ...form, active: true, syncedAt: new Date() }])
    setForm({ name: '', riotId: '', tag: '', lane: 'MID' }); setAdding(false)
  }
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="사용자 관리"><div className="modal"><div className="modal-head"><div><p className="eyebrow">프로젝트 사용자</p><h2>사용자 관리</h2></div><button onClick={onClose} className="icon-button" aria-label="닫기"><X size={20} /></button></div><p className="modal-copy">표시 이름과 Riot 계정 정보를 분리해 관리합니다. 비활성 사용자는 분석 사용자 목록에 표시되지 않습니다.</p>
    <div className="user-rows">{rows.map((user) => <div className={`user-row ${user.active ? '' : 'inactive'}`} key={user.id}><div className="user-initial">{user.name.slice(0, 1)}</div><div><b>{user.name}</b><p>{user.riotId}<span>#{user.tag}</span> · KR · 기본 {laneLabels[user.lane]}</p></div><button className="status-button" onClick={() => setRows((current) => current.map((row) => row.id === user.id ? { ...row, active: !row.active } : row))}>{user.active ? '활성' : '비활성'}</button></div>)}</div>
    {isAdding ? <div className="add-form"><input placeholder="표시 이름" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input placeholder="Riot ID" value={form.riotId} onChange={(e) => setForm({ ...form, riotId: e.target.value })} /><input placeholder="태그 (예: KR1)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} /><select value={form.lane} onChange={(e) => setForm({ ...form, lane: e.target.value as Lane })}>{(Object.keys(laneLabels) as Lane[]).map((key) => <option key={key} value={key}>{laneLabels[key]}</option>)}</select><button className="primary-button" onClick={addUser}>추가</button></div> : <button className="add-user" onClick={() => setAdding(true)}><Plus size={17} /> 사용자 추가</button>}
    <div className="modal-actions"><button className="ghost-button" onClick={onClose}>취소</button><button className="primary-button" onClick={() => onSave(rows)}>변경사항 저장</button></div>
  </div></div>
}
