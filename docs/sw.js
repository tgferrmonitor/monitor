self.addEventListener('message', function(event) {
  const { playerName, status, jogo } = event.data || {};
  // Evita notificações vazias
  if (!playerName || !status) return;
  self.registration.showNotification(
    `${playerName} está ${status === 'Jogando' ? 'jogando' : 'online'}!`,
    {
      body: `Jogo: ${jogo || 'N/A'}`,
      icon: '/icon.png' // Opcional: use seu ícone ou remova esta linha
    }
  );
});

// Opcional: permite interação ao clicar na notificação
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  // Foca ou abre a página principal
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});