// VocaSnap Service Worker - 백그라운드 알림
const CACHE_NAME = 'vocasnap-v5';

// 설치
self.addEventListener('install', e => {
  self.skipWaiting();
});

// 활성화
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// 메인 앱에서 메시지 수신 → 알림 스케줄 정보 저장
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTI') {
    // {times: ['09:00','20:00'], enabled: true}
    self._notiConfig = e.data;
    // 알림 타이머 시작
    startNotiCheck();
  }
  if (e.data?.type === 'CHECK_NOW') {
    checkAndNotify();
  }
});

// Periodic Background Sync (Chrome Android 지원)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'vocasnap-review-check') {
    e.waitUntil(checkAndNotify());
  }
});

// 일반 sync 이벤트 (폴백)
self.addEventListener('sync', e => {
  if (e.tag === 'vocasnap-noti-sync') {
    e.waitUntil(checkAndNotify());
  }
});

// 알림 클릭 → 앱 열기
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if (client.url.includes('vocasnap') && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow('./');
    })
  );
});

// 알림 체크 타이머
let notiInterval = null;
function startNotiCheck() {
  if (notiInterval) clearInterval(notiInterval);
  notiInterval = setInterval(() => checkAndNotify(), 60000); // 1분마다
}

async function checkAndNotify() {
  const config = self._notiConfig;
  if (!config || !config.enabled) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const nowTime = `${hh}:${mm}`;

  if (!config.times.includes(nowTime)) return;

  // 같은 분에 중복 방지
  if (self._lastNotiTime === nowTime) return;
  self._lastNotiTime = nowTime;

  // 복습 단어 수 체크 (메인 앱에서 전달받은 값)
  const dueCount = config.dueCount || 0;
  if (dueCount <= 0) return;

  try {
    await self.registration.showNotification('📚 VocaSnap 복습 시간!', {
      body: `복습할 단어 ${dueCount}개가 기다리고 있어요!`,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'vocasnap-review',
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: './' },
      actions: [
        { action: 'open', title: '학습 시작' },
        { action: 'dismiss', title: '나중에' }
      ]
    });
  } catch (err) {
    console.log('SW Notification failed:', err);
  }
}
