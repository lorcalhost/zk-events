import { ZKEvent, Account, whitelistSize, initialBalance } from './ZKEvent';
import {
  isReady,
  shutdown,
  Experimental,
  PrivateKey,
  Mina,
  UInt32,
  AccountUpdate,
} from 'snarkyjs';

import QRCode from 'qrcode';

import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

await isReady;

// enable if want interactive console
const interactive = true;
// very slow on M1 macs if enabled
const doProofs = false;
// display QR code in terminal
const doQr = true;

let wlSize = whitelistSize;
let maxNumberOfTicketsPerAccount = 2;
let maxTicketsPerEvent = 100;

if (interactive) {
  const question = (questionText: string) =>
    new Promise<string>((resolve) => rl.question(questionText, resolve));
  wlSize = Number(await question('Insert whitelist size: '));
  maxNumberOfTicketsPerAccount = Number(
    await question('Insert number of tickets per account: ')
  );
  maxTicketsPerEvent = Number(await question('Insert max tickets per event: '));
  await question('Press enter to claim your ticket 🎟️');
  rl.close();
}

class MerkleWitness extends Experimental.MerkleWitness(wlSize) {}

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
// we initialize a new Merkle Tree with height wlSize
const Tree = new Experimental.MerkleTree(wlSize);

Tree.setLeaf(0n, alice.hash());
Tree.setLeaf(1n, bob.hash());
Tree.setLeaf(2n, carol.hash());
Tree.setLeaf(3n, dave.hash());

// generate initial commitment with whitelist
let initialCommitment = Tree.getRoot();

let zkAppInstance = new ZKEvent(zkappAddress);
console.log('Deploying event..');
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
    UInt32.fromNumber(maxTicketsPerEvent),
    UInt32.fromNumber(maxNumberOfTicketsPerAccount)
  );
  zkAppInstance.sign(zkappKey);
});
await tx.send();

console.log('Your initial tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Claiming a ticket..');
await claimTicket('Alice', 0n);
console.log('Successfully claimed ticket.');
console.log('Your tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);
console.log('Sending ticket to Bob..');
await sendTicket('Alice', 0n, 'Bob', 1n);
console.log('Your tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);

setTimeout(shutdown, 0);

async function claimTicket(name: Names, index: bigint) {
  let account = Accounts.get(name)!;
  let w = Tree.getWitness(index);
  let witness = new MerkleWitness(w);

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
  let accHash = account.hash();
  Tree.setLeaf(index, accHash);
  if (doQr) {
    QRCode.toString(
      account.publicKey.toBase58(),
      { type: 'terminal' },
      function (err, url) {
        console.log(url);
      }
    );
  }
  zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
}

async function sendTicket(
  nameFrom: Names,
  indexFrom: bigint,
  nameTo: Names,
  indexTo: bigint
) {
  let fromAccount = Accounts.get(nameFrom)!;
  let toAccount = Accounts.get(nameTo)!;

  // compute from witness
  let wFrom = Tree.getWitness(indexFrom);
  let witnessFrom = new MerkleWitness(wFrom);

  // compute to witness
  let fromHash = new Account(
    fromAccount.publicKey,
    fromAccount.tickets.sub(1)
  ).hash();
  Tree.setLeaf(indexFrom, fromHash);
  let wTo = Tree.getWitness(indexTo);
  let witnessTo = new MerkleWitness(wTo);

  // send transaction
  let tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.sendTicket(
      fromAccount,
      witnessFrom,
      toAccount,
      witnessTo,
      Local.testAccounts[0].privateKey
    );
    if (!doProofs) zkAppInstance.sign(zkappKey);
  });
  if (doProofs) {
    await tx.prove();
  }
  await tx.send();

  // if the transaction was successful, we can update our off-chain storage as well
  fromAccount.tickets = fromAccount.tickets.sub(1);
  toAccount.tickets = toAccount.tickets.add(1);
  Tree.setLeaf(indexTo, toAccount.hash());
  if (doQr) {
    QRCode.toString(
      toAccount.publicKey.toBase58(),
      { type: 'terminal' },
      function (err, url) {
        console.log(url);
      }
    );
  }
  zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
}
