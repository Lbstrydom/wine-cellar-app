const fs = require('fs');
const content = fs.readFileSync('public/index.html', 'utf8');

const sections = [
  { title: 'Rating Preferences', id: 'rating-preferences' },
  { title: 'Display Settings', id: 'display' },
  { title: 'Drink Soon Auto Rules', id: 'drink-soon-rules' },
  { title: 'Storage Conditions', id: 'storage-conditions' },
  { title: 'Cellar Layout', id: 'cellar-layout' },
  { title: 'Account Credentials', id: 'account-credentials' },
  { title: 'Awards Database', id: 'awards-database' },
  { title: 'Storage Areas', id: 'storage-areas' },
  { title: 'Backup &amp; Export', id: 'backup-export' },
  { title: 'Install App', id: 'install-app' },
  { title: 'About', id: 'about' },
];

let result = content;

for (const { title, id } of sections) {
  const oldH3 = `<h3 class="settings-section-title">${title}</h3>`;
  const newBtn = `<button class="settings-section-toggle" aria-expanded="true" data-section-id="${id}">${title} <span class="settings-section-arrow">▾</span></button>`;
  if (result.includes(oldH3)) {
    result = result.split(oldH3).join(newBtn);
    console.log('Replaced:', title);
  } else {
    console.log('NOT FOUND:', title, JSON.stringify(oldH3));
  }
}

fs.writeFileSync('public/index.html', result, 'utf8');
console.log('Done.');
