import {
  SmartContract,
  isReady,
  shutdown,
  Poseidon,
  Field,
  Experimental,
  Permissions,
  DeployArgs,
  State,
  state,
  CircuitValue,
  PublicKey,
  UInt64,
  prop,
  Mina,
  method,
  UInt32,
  PrivateKey,
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
const interactive = false;
// very slow on M1 macs if enabled
const doProofs = false;
// display QR code in terminal
const doQr = true;

let whitelistSize = 8;
let maxNumberOfTicketsPerAccount = 2;
let maxTicketsPerEvent = 100;

if (interactive) {
  const question = (questionText: string) =>
    new Promise<string>((resolve) => rl.question(questionText, resolve));
  whitelistSize = Number(await question('Insert whitelist size: '));
  maxNumberOfTicketsPerAccount = Number(
    await question('Insert number of tickets per account: ')
  );
  maxTicketsPerEvent = Number(await question('Insert max tickets per event: '));
  await question('Press enter to claim your ticket 🎟️');
  rl.close();
}

class MerkleWitness extends Experimental.MerkleWitness(whitelistSize) {}

class Account extends CircuitValue {
  @prop publicKey: PublicKey;
  @prop tickets: UInt32;

  constructor(publicKey: PublicKey, tickets: UInt32) {
    super(publicKey, tickets);
    this.publicKey = publicKey;
    this.tickets = tickets;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }

  addTicket(n: number): Account {
    return new Account(this.publicKey, this.tickets.add(n));
  }

  removeTicket(n: number): Account {
    this.tickets.assertGte(UInt32.fromNumber(n));
    return new Account(this.publicKey, this.tickets.sub(n));
  }
}

let initialCommitment: Field = Field.zero;

class ZKEvent extends SmartContract {
  @state(Field) commitment = State<Field>();
  @state(UInt32) ticketsClaimed = State<UInt32>();
  @state(UInt32) maxTickets = State<UInt32>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
    this.balance.addInPlace(UInt64.fromNumber(initialBalance));
    this.commitment.set(initialCommitment);
    this.ticketsClaimed.set(UInt32.fromNumber(0));
    this.maxTickets.set(UInt32.fromNumber(maxTicketsPerEvent));
  }

  @method
  claimTicket(account: Account, path: MerkleWitness) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    let ticketsClaimed = this.ticketsClaimed.get();
    this.ticketsClaimed.assertEquals(ticketsClaimed);

    let maxTickets = this.maxTickets.get();
    this.maxTickets.assertEquals(maxTickets);

    // check that account is within the committed Merkle Tree (whitelist)
    path.calculateRoot(account.hash()).assertEquals(commitment);

    // check if more tickets are available
    ticketsClaimed.assertLt(maxTickets);

    // check if user already has max number of tickets
    account.tickets.assertLt(UInt32.fromNumber(maxNumberOfTicketsPerAccount));

    // UPDATE STATE
    // add 1 ticket to account
    let newAccount = account.addTicket(1);

    // calculate new merkle root
    let newCommitment = path.calculateRoot(newAccount.hash());
    this.commitment.set(newCommitment);

    // update number of claimed tickets
    this.ticketsClaimed.set(ticketsClaimed.add(UInt32.fromNumber(1)));
  }

  @method
  sendTicket(
    from: Account,
    fromPath: MerkleWitness,
    to: Account,
    toPath: MerkleWitness
  ) {
    // CHECKS
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    // ensure first witness is correct
    fromPath.calculateRoot(from.hash()).assertEquals(commitment);

    // assert from has at least one ticket and to has less than max allowed tickets
    from.tickets.assertGte(UInt32.fromNumber(1));
    to.tickets.assertLt(UInt32.fromNumber(maxNumberOfTicketsPerAccount));

    // UPDATE STATE
    // remove 1 ticket from account
    let newFromAccount = from.removeTicket(1);

    // ensure pre computation of second witness is correct
    let tempCommitment = fromPath.calculateRoot(newFromAccount.hash());
    toPath.calculateRoot(to.hash()).assertEquals(tempCommitment);

    // add 1 ticket to account
    let newToAccount = to.addTicket(1);

    // calculate new merkle root
    let newCommitment = toPath.calculateRoot(newToAccount.hash());
    this.commitment.set(newCommitment);
  }
}

type Names = 'Alice' | 'Bob' | 'Carol' | 'Dave';

let Local = Mina.LocalBlockchain();
Mina.setActiveInstance(Local);
let initialBalance = 10_000_000_000;

let feePayer = Local.testAccounts[0].privateKey;

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
const Tree = new Experimental.MerkleTree(whitelistSize);

Tree.setLeaf(0n, alice.hash());
Tree.setLeaf(1n, bob.hash());
Tree.setLeaf(2n, carol.hash());
Tree.setLeaf(3n, dave.hash());

// generate initial commitment with whitelist
initialCommitment = Tree.getRoot();

let zkEventsZkApp = new ZKEvent(zkappAddress);
console.log('Deploying event..');
if (doProofs) {
  await ZKEvent.compile();
}
let tx = await Mina.transaction(feePayer, () => {
  AccountUpdate.fundNewAccount(feePayer, { initialBalance });
  zkEventsZkApp.deploy({ zkappKey });
});
await tx.send();

console.log('Initial tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Claiming a ticket..');
await claimTicket('Alice', 0n);
console.log('Successfully claimed ticket.');
console.log('Alice tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);
console.log('Sending ticket to Bob..');
await sendTicket('Alice', 0n, 'Bob', 1n);
console.log('Alice tickets: ' + Accounts.get('Alice')?.tickets);
console.log('Bob tickets: ' + Accounts.get('Bob')?.tickets);

setTimeout(shutdown, 0);

async function claimTicket(name: Names, index: bigint) {
  let account = Accounts.get(name)!;
  let w = Tree.getWitness(index);
  let witness = new MerkleWitness(w);

  let tx = await Mina.transaction(feePayer, () => {
    zkEventsZkApp.claimTicket(account, witness);
    if (!doProofs) zkEventsZkApp.sign(zkappKey);
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
      account.publicKey.toString(),
      { type: 'terminal' },
      function (err, url) {
        console.log(url);
      }
    );
  }
  zkEventsZkApp.commitment.get().assertEquals(Tree.getRoot());
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
  let tx = await Mina.transaction(feePayer, () => {
    zkEventsZkApp.sendTicket(fromAccount, witnessFrom, toAccount, witnessTo);
    if (!doProofs) zkEventsZkApp.sign(zkappKey);
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
      toAccount.publicKey.toString(),
      { type: 'terminal' },
      function (err, url) {
        console.log(url);
      }
    );
  }
  zkEventsZkApp.commitment.get().assertEquals(Tree.getRoot());
}
