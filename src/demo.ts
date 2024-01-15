import { ZKEvent, Account, whitelistSize, initialBalance } from './ZKEvent';
import {
  isReady,
  shutdown,
  PrivateKey,
  Mina,
  UInt32,
  UInt64,
  AccountUpdate,
  MerkleTree,
  MerkleWitness,
} from 'snarkyjs';

import { generateQr } from './Common';

import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

await isReady;

const maxNumberOfTicketsPerAccount = 2; // max number of tickets a user can claim
const maxTicketsPerEvent = 100; // max number of tickets an event can emit
const doProofs = false; // very slow on M1 macs if enabled
const doQr = true; // display QR code in terminal

class MyMerkleWitness extends MerkleWitness(whitelistSize) {}

type Names = 'Alice' | 'Bob' | 'Carol' | 'Dave';

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);

let deployerAccount = Local.testAccounts[0].privateKey;

// zkapp account
let zkappKey = PrivateKey.random();
let zkappAddress = zkappKey.toPublicKey();

// this map serves as our off-chain in-memory storage
let Accounts: Map<string, Account> = new Map<Names, Account>();

let alice = new Account(Local.testAccounts[0].publicKey, UInt32.from(0));
let bob = new Account(Local.testAccounts[1].publicKey, UInt32.from(0));
let carol = new Account(Local.testAccounts[2].publicKey, UInt32.from(0));
let dave = new Account(Local.testAccounts[3].publicKey, UInt32.from(0));

Accounts.set('Alice', alice);
Accounts.set('Bob', bob);
Accounts.set('Carol', carol);
Accounts.set('Dave', dave);

// we now need "wrap" the Merkle tree around our off-chain storage
// we initialize a new Merkle Tree with height whitelistSize
const Tree = new MerkleTree(whitelistSize);

Tree.setLeaf(0n, alice.hash());
Tree.setLeaf(1n, bob.hash());
Tree.setLeaf(2n, carol.hash());
Tree.setLeaf(3n, dave.hash());

// generate initial commitment with whitelist
let initialCommitment = Tree.getRoot();

let zkAppInstance = new ZKEvent(zkappAddress);
if (doProofs) {
  await ZKEvent.compile();
}
let tx = await Mina.transaction(deployerAccount, () => {
  AccountUpdate.fundNewAccount(deployerAccount, { initialBalance });
  zkAppInstance.deploy({ zkappKey });
  zkAppInstance.sign(zkappKey);
});
await tx.send();
tx = await Mina.transaction(deployerAccount, () => {
  zkAppInstance.setup(
    initialCommitment,
    UInt32.from(maxTicketsPerEvent),
    UInt32.from(maxNumberOfTicketsPerAccount),
    UInt64.from(Date.now() + 3600 * 1000 * 24),
    deployerAccount
  );
  zkAppInstance.sign(zkappKey);
});
await tx.send();

console.clear();
console.log(`       _                              _             _                      
   ___| | __      _____   _____ _ __ | |_ ___    __| | ___ _ __ ___   ___  
  |_  / |/ /____ / _ \\ \\ / / _ \\ '_ \\| __/ __|  / _\` |/ _ \\ '_ \` _ \\ / _ \\ 
   / /|   <_____|  __/\\ V /  __/ | | | |_\\__ \\ | (_| |  __/ | | | | | (_) |
  /___|_|\\_\\     \\___| \\_/ \\___|_| |_|\\__|___/  \\__,_|\\___|_| |_| |_|\\___/\n`);
console.log(
  'Welcome to the zk-events demo!\n',
  `(Settings: whitelistSize=${whitelistSize},`,
  `maxTicketsPerUser=${maxNumberOfTicketsPerAccount},`,
  `maxTicketsPerEvent=${maxTicketsPerEvent},`,
  `QR=${doQr},`,
  `eventDeployed=true,`,
  `timeStart=\`${new Date(Date.now() + 3600 * 1000 * 24).toUTCString()}\`),`
);
const question = (questionText: string) =>
  new Promise<string>((resolve) => rl.question(questionText, resolve));

let x;
while (typeof x === 'undefined') {
  let varName = await question(
    '\nWhat do you want to do?\n' +
      '0 - 🎟️  Claim ticket\n' +
      '1 - 💌 Send ticket\n' +
      '2 - ❓ Ask Bob to send you a ticket\n' +
      '3 - ✅ Verify ticket validity\n' +
      '4 - Exit\n' +
      'Choice: '
  );
  switch (varName) {
    case '0':
      await claimTicketCase();
      break;

    case '1':
      await sendTicketCase();
      break;

    case '2':
      await requestSendTicketCase();
      break;

    case '3':
      await checkValidityCase();
      break;

    case '4':
      await exitCase();
      break;

    default:
      console.log('Invalid choice');
      break;
  }
}

async function claimTicket(name: Names, index: bigint) {
  let account = Accounts.get(name)!;
  let w = Tree.getWitness(index);
  let witness = new MyMerkleWitness(w);

  let tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.claimTicket(
      account,
      witness,
      Local.testAccounts[0].privateKey
    );
    if (!doProofs) zkAppInstance.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  await tx.send();

  // if the transaction was successful, we can update our off-chain storage as well
  account.tickets = account.tickets.add(1);
  Tree.setLeaf(index, account.hash());
  await generateQr(zkappKey.toPublicKey(), account, index, doQr);
  zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
}

async function sendTicket(
  nameFrom: Names,
  indexFrom: bigint,
  nameTo: Names,
  indexTo: bigint,
  pKeyIndex: number
) {
  let fromAccount = Accounts.get(nameFrom)!;
  let toAccount = Accounts.get(nameTo)!;

  // compute from witness
  let wFrom = Tree.getWitness(indexFrom);
  let witnessFrom = new MyMerkleWitness(wFrom);

  // compute to witness
  let fromHash = new Account(
    fromAccount.publicKey,
    fromAccount.tickets.sub(1),
    fromAccount.transferred.add(1)
  ).hash();
  Tree.setLeaf(indexFrom, fromHash);
  let wTo = Tree.getWitness(indexTo);
  let witnessTo = new MyMerkleWitness(wTo);

  // send transaction
  let tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.sendTicket(
      fromAccount,
      witnessFrom,
      toAccount,
      witnessTo,
      Local.testAccounts[pKeyIndex].privateKey
    );
    if (!doProofs) zkAppInstance.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  await tx.send();

  // if the transaction was successful, we can update our off-chain storage as well
  fromAccount.tickets = fromAccount.tickets.sub(1);
  fromAccount.transferred = fromAccount.transferred.add(1);
  toAccount.tickets = toAccount.tickets.add(1);
  Tree.setLeaf(indexTo, toAccount.hash());
  await generateQr(zkappKey.toPublicKey(), toAccount, indexTo, doQr);
  zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
}

async function claimTicketCase() {
  let alice = Accounts.get('Alice');
  if (
    alice?.tickets
      .add(alice.transferred)
      .equals(UInt32.from(maxNumberOfTicketsPerAccount))
      .toBoolean()
  ) {
    console.log(
      `❗️You already have claimed the maximum number of tickets allowed per user (${maxNumberOfTicketsPerAccount})`
    );
    return;
  }

  console.log('Your initial tickets: ' + Accounts.get('Alice')?.tickets);
  console.log('Claiming a ticket..');
  await claimTicket('Alice', 0n);
  console.log('Successfully claimed ticket.');
  console.log('Your tickets: ' + Accounts.get('Alice')?.tickets);
  console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);
}

async function sendTicketCase() {
  let bob = Accounts.get('Bob');
  if (Accounts.get('Alice')?.tickets.lt(UInt32.from(1)).toBoolean()) {
    console.log(`❗️You do not have any ticket to give to Bob (0)`);
    return;
  }

  if (
    bob?.tickets
      .add(bob.transferred)
      .equals(UInt32.from(maxNumberOfTicketsPerAccount))
      .toBoolean()
  ) {
    console.log(
      `❗️Bob already has claimed the maximum number of tickets allowed per user (${maxNumberOfTicketsPerAccount})`
    );
    return;
  }

  console.log('Sending ticket to Bob..');
  await sendTicket('Alice', 0n, 'Bob', 1n, 0);
  console.log('Your tickets: ' + Accounts.get('Alice')?.tickets);
  console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);
}

async function requestSendTicketCase() {
  if (Accounts.get('Bob')?.tickets.lt(UInt32.from(1)).toBoolean()) {
    console.log(`❗️Bob does not have any ticket to give (0)`);
    return;
  }

  if (
    Accounts.get('Alice')
      ?.tickets.equals(UInt32.from(maxNumberOfTicketsPerAccount))
      .toBoolean()
  ) {
    console.log(
      `❗️You already have claimed the maximum number of tickets allowed per user (${maxNumberOfTicketsPerAccount})`
    );
    return;
  }

  console.log('Bob is sending you a ticket..');
  await sendTicket('Bob', 1n, 'Alice', 0n, 1);
  console.log('Your tickets: ' + Accounts.get('Alice')?.tickets);
  console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);
}

async function checkValidityCase() {
  if (Accounts.get('Alice')?.tickets.lt(UInt32.from(1)).toBoolean()) {
    console.log(`❗️Sorry, you can't enter the event! (0 tickets)`);
    return;
  }
  const givenAccount = Accounts.get('Alice');
  const givenIndex = 0n;
  const treeCopy = Tree;
  if (givenAccount) {
    // check user account hashes to merkle tree leaf
    treeCopy.setLeaf(givenIndex, givenAccount.hash());
    treeCopy.getRoot().assertEquals(Tree.getRoot());
    // check computed root equals contract-stored root
    treeCopy.getRoot().assertEquals(zkAppInstance.commitment.get());
    console.log(
      `✅ Congrats, you and (${givenAccount?.tickets.sub(
        UInt32.from(1)
      )}) other people can enter the event!`
    );
  }
}

async function exitCase() {
  setTimeout(shutdown, 0);
  rl.close();
  x = 1;
}
