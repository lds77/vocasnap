// VocaSnap Service Worker + Firebase Cloud Messaging

// 1. Firebase 라이브러리 로드
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

// 2. Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyBt4ps64OpNYOxX6S9F3Kz3Hyy-BTt7pzI",
  authDomain: "vocasnap-839e7.firebaseapp.com",
  projectId: "vocasnap-839e7",
  storageBucket: "vocasnap-839e7.firebasestorage.app",
  messagingSenderId: "46938507381",
  appId: "1:46938507381:web:fbaf74bb9749ba3448d03c",
  measurementId: "G-MJY0DJ6JDJ"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// 3. 오프라인 캐시
const CACHE_NAME = 'vocasnap-v5.1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 설치: 캐시 저장
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 오프라인: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// 4. FCM 백그라운드 메시지 수신 (화면 꺼져있을 때)
messaging.onBackgroundMessage((payload) => {
  console.log('백그라운드 메시지:', payload);

  const title = payload.notification?.title || '📚 VocaSnap';
  const options = {
    body: payload.notification?.body || '복습할 단어가 기다리고 있어요!',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'vocasnap-review',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: './' },
    actions: [
      { action: 'open', title: '학습 시작' },
      { action: 'dismiss', title: '나중에' }
    ]
  };

  self.registration.showNotification(title, options);
});

// 5. 알림 클릭 → 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 VocaSnap 탭이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes('vocasnap') && 'focus' in client) {
          return client.focus();
        }
      }
      // 없으면 새 탭으로 열기
      return self.clients.openWindow(urlToOpen);
    })
  );
});