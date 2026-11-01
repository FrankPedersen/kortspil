const tableId = new URLSearchParams(location.search).get('table');

if (tableId) {
  const { startMultiplayer } = await import('./multiplayer.js');
  startMultiplayer(tableId);
} else {
  await import('./app.js');
}
