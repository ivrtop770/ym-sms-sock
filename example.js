const { YemotSmsClient } = require('./lib/index');

const client = new YemotSmsClient({
  sipUser: process.env.YEMOT_SIP_USER,
  password: process.env.YEMOT_SIP_PASSWORD,
});

client.on('registered', () => {
  console.log('המערכת רשומה');
  client.sendMessage(process.env.YEMOT_SIP_TO, 'הודעה יוצאת');
});

client.on('message', (msg) => {
  console.log('מאת', msg.fromUser, 'תוכן', msg.body);
  msg.reply('קיבלתי, תודה');
});

client.start();