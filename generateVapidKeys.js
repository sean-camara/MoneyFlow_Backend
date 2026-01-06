import webPush from 'web-push';

const vapidKeys = webPush.generateVAPIDKeys();

console.log('\n🔑 VAPID Keys Generated!\n');
console.log('Copy these into your .env file:\n');
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
console.log('\n');
