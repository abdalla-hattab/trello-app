var t = window.TrelloPowerUp.iframe();

document.getElementById('save-btn').addEventListener('click', function(){
  const days = parseInt(document.getElementById('days').value || 0, 10);
  const hours = parseInt(document.getElementById('hours').value || 0, 10);
  const minutes = parseInt(document.getElementById('minutes').value || 0, 10);
  
  const totalMs = (days * 24 * 60 * 60 * 1000) + (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
  
  if (totalMs > 0) {
    const dueDate = new Date(Date.now() + totalMs);
    // Store the due date timestamp in the card's shared plugin data
    t.set('card', 'shared', 'customDueDate', dueDate.getTime()).then(() => {
      t.closePopup();
    });
  } else {
    t.closePopup();
  }
});

document.getElementById('clear-btn').addEventListener('click', function(){
  t.remove('card', 'shared', 'customDueDate').then(() => {
    t.closePopup();
  });
});
