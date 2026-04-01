

// Initialize the Trello Power-Up
window.TrelloPowerUp.initialize({
  // Adding a button to the back of the card
  'card-buttons': function (t, options) {
    return [{
      icon: 'https://cdn.glitch.com/1b42d7ef-15bc-4aee-872f-515a00a16b9c%2Ficon.svg?1589416568853',
      text: 'Set Relative Due Date',
      callback: function (t) {
        return t.popup({
          title: "Set Due Date",
          url: './popup.html',
          height: 250
        });
      }
    }];
  },
  
  // Display a badge on the front of the card
  'card-badges': function (t, options) {
    return t.get('card', 'shared', 'customDueDate').then(function (customDueDate) {
      if (customDueDate) {
        const date = new Date(customDueDate);
        const isOverdue = date.getTime() < Date.now();
        // Return an array of badges
        return [{
          text: 'Due: ' + date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
          color: isOverdue ? 'red' : 'blue'
        }];
      }
      return [];
    });
  },

  // Display a detailed badge on the back of the card
  'card-detail-badges': function (t, options) {
    return t.get('card', 'shared', 'customDueDate').then(function (customDueDate) {
      if (customDueDate) {
        const date = new Date(customDueDate);
        const isOverdue = date.getTime() < Date.now();
        return [{
          title: 'Relative Due',
          text: date.toLocaleString(),
          color: isOverdue ? 'red' : 'blue',
          callback: function (t) {
            return t.popup({
              title: "Set Due Date",
              url: './popup.html',
              height: 250
            });
          }
        }];
      }
      return [];
    });
  }
});

console.log('Trello Power-Up initialized with relative due dates.');
