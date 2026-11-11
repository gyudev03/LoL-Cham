import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Firebase 웹 설정은 브라우저 앱을 식별하기 위한 값이며 비밀 키가 아니다.
// Riot API 키나 Firebase 서비스 계정 키는 이 파일에 넣으면 안 된다.
const firebaseConfig = {
  apiKey: 'AIzaSyAaE5KAOeS-mIU6HlQfAeafTDm6mw0XgsM',
  authDomain: 'lol-cham.firebaseapp.com',
  projectId: 'lol-cham',
  storageBucket: 'lol-cham.firebasestorage.app',
  messagingSenderId: '741438225532',
  appId: '1:741438225532:web:77941c9672815d31c85df9',
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
