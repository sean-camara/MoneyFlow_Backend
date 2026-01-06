import webPush from 'web-push';

const vapidKeys = webPush.generateVAPIDKeys();

console.log('VAPID Keys Generated:');
console.log('=====================');
console.log('VAPID_PUBLIC_KEY=' + vapidKeys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + vapidKeys.privateKey);
console.log('');
console.log('Add these to your .env file');
