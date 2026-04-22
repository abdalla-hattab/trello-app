const data = await fetch("https://managing-work-live-default-rtdb.firebaseio.com/agency_trello_app_data.json").then(r => r.text());
console.log(data.length);
