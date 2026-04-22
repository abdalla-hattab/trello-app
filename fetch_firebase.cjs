const firebase = require('firebase/compat/app');
require('firebase/compat/database');

const firebaseConfig = {
  apiKey: "AIzaSyC7Ty_uaB7VE8ucSPS6ZlMNFAcnM-qpagk",
  authDomain: "managing-work-live.firebaseapp.com",
  databaseURL: "https://managing-work-live-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "managing-work-live",
  storageBucket: "managing-work-live.firebasestorage.app",
  messagingSenderId: "402823749331",
  appId: "1:402823749331:web:27b250c52a49db6091be26"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
db.ref('agency_trello_app_data').once('value').then(snap => {
    const fs = require('fs');
    fs.writeFileSync('firebase_dump.json', JSON.stringify(snap.val(), null, 2));
    console.log("Dumped to firebase_dump.json");
    process.exit(0);
}).catch(console.error);
