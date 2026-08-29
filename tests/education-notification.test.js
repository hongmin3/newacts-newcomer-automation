const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const educationSource = fs.readFileSync(
  path.join(root, 'education-project', '교육 출석 현황 업데이트.gs'),
  'utf8'
);
const notificationSource = fs.readFileSync(
  path.join(root, 'education-project', '문자 명단 리스트.gs'),
  'utf8'
);

const sent = [];
const context = {
  console,
  MailApp: {
    sendEmail(message) {
      sent.push(message);
    }
  }
};
vm.createContext(context);
vm.runInContext(educationSource + '\n' + notificationSource, context);

const expectedRecipients = [
  'ksj747172@gmail.com',
  'kimth6805@gmail.com',
  'rnrnwkddn@naver.com',
  'wnehdrms123@naver.com',
  'whduswn94@naver.com'
];

vm.runInContext(`
  sendEducationEmail_({
    recipients: NOTIFICATION_CONFIG.productionRecipients,
    subject: 'recipient test',
    body: 'test'
  });
`, context);

assert.equal(sent.length, 1);
assert.deepEqual(sent[0].to.split(','), expectedRecipients);
assert.equal(new Set(sent[0].to.split(',')).size, 5);
assert.match(notificationSource, /recipients:\s*NOTIFICATION_CONFIG\.productionRecipients/);

console.log('education notification recipient checks passed');
