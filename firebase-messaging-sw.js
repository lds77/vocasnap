// 1. 파이어베이스 라이브러리 로드
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

// 2. 파이어베이스 설정 (사용자님의 설정값 적용)
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

// 3. 오프라인 캐시 설정 (기존 v5 유지)
const CACHE_NAME = 'vocasnap-v5';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// [설치] 캐시 파일 저장
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// [활성화] 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// [오프라인 기능] 네트워크 우선, 실패 시 캐시에서 불러오기
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// 4. 파이어베이스 백그라운드 알림 수신
messaging.onBackgroundMessage((payload) => {
  console.log('백그라운드 메시지 수신:', payload);
  const notificationTitle = payload.notification.title || 'VocaSnap 알림';
  const notificationOptions = {
    body: payload.notification.body,
    icon: './icon-192.png',
    badge: './icon-192.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 5. 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === '/' && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});