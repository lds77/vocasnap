// sw.js - 백그라운드 알림 수신용
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.9.0/firebase-messaging-compat.js');

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

// 화면이 꺼져있을 때 알림을 처리
messaging.onBackgroundMessage((payload) => {
  const notificationTitle = payload.notification.title || 'VocaSnap 알림';
  const notificationOptions = {
    body: payload.notification.body,
    icon: './icon-192.png', // 이미지 경로 확인 필요
    badge: './icon-192.png'
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 시 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});