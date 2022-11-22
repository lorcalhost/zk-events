import { ZKEvent, Account, whitelistSize, initialBalance } from './ZKEvent';
import {
  isReady,
  shutdown,
  Field,
  PublicKey,
  Mina,
  UInt32,
  UInt64,
  PrivateKey,
  AccountUpdate,
  MerkleWitness,
  MerkleTree,
} from 'snarkyjs';

import { generateQr } from './Common';

type Names = 'Alice' | 'Bob' | 'Carol' | 'Dave';

let maxNumberOfTicketsPerAccount = 2; // max number of tickets a user can claim
let maxTicketsPerEvent = 100; // max number of tickets an event can emit
const doQr = false; // generate QR code in terminal
const doProofs = false; // very slow on M1 macs if enabled

class MyMerkleWitness extends MerkleWitness(whitelistSize) {}

describe('ZKEvent', () => {
  let deployerAccount: PrivateKey,
    zkAppPrivateKey: PrivateKey,
    zkAppAddress: PublicKey,
    testAccounts: {
      publicKey: PublicKey;
      privateKey: PrivateKey;
    }[],
    Accounts: Map<string, Account> = new Map<Names, Account>(),
    Tree: MerkleTree,
    initialCommitment: Field;

  beforeEach(async () => {
    await isReady;
    testAccounts = createLocalBlockchain();
    deployerAccount = testAccounts[0].privateKey;
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    let alice = new Account(testAccounts[0].publicKey, UInt32.from(0));
    let bob = new Account(testAccounts[1].publicKey, UInt32.from(0));
    let carol = new Account(testAccounts[2].publicKey, UInt32.from(0));
    let dave = new Account(testAccounts[3].publicKey, UInt32.from(0));
    // setup accounts
    Accounts.set('Alice', alice);
    Accounts.set('Bob', bob);
    Accounts.set('Carol', carol);
    Accounts.set('Dave', dave);
    // setup tree
    Tree = new MerkleTree(whitelistSize);
    Tree.setLeaf(0n, alice.hash());
    Tree.setLeaf(1n, bob.hash());
    Tree.setLeaf(2n, carol.hash());
    Tree.setLeaf(3n, dave.hash());
    // generate whitelist root
    initialCommitment = Tree.getRoot();
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  it('generates and deploys the `ZKEvent` smart contract', async () => {
    await deployZKEvent(
      zkAppAddress,
      zkAppPrivateKey,
      deployerAccount,
      initialCommitment
    );
  });

  it('correctly sets up the `ZKEvent` contract', async () => {
    const zkAppInstance = await deployZKEvent(
      zkAppAddress,
      zkAppPrivateKey,
      deployerAccount,
      initialCommitment
    );
    const state = zkAppInstance.owner.get();
    expect(state).toEqual(deployerAccount.toPublicKey()); // flag has been switched to 1
  });

  it('allows claiming a ticket if a user is whitelisted', async () => {
    const zkAppInstance = await deployZKEvent(
      zkAppAddress,
      zkAppPrivateKey,
      deployerAccount,
      initialCommitment
    );

    let account = Accounts.get('Alice')!;
    let index = 0n;
    let w = Tree.getWitness(index);
    let witness = new MyMerkleWitness(w);

    await claimTicket(
      deployerAccount,
      zkAppInstance,
      account,
      witness,
      testAccounts[0].privateKey,
      zkAppPrivateKey
    );

    // update off chain storage
    account.tickets = account.tickets.add(1);
    Tree.setLeaf(index, account.hash());
    await generateQr(zkAppPrivateKey.toPublicKey(), account, 0n, doQr);

    zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
  });

  it('allows allows sending a ticket to another user', async () => {
    const zkAppInstance = await deployZKEvent(
      zkAppAddress,
      zkAppPrivateKey,
      deployerAccount,
      initialCommitment
    );

    let account = Accounts.get('Alice')!;
    let index = 0n;
    let w = Tree.getWitness(index);
    let witness = new MyMerkleWitness(w);

    await claimTicket(
      deployerAccount,
      zkAppInstance,
      account,
      witness,
      testAccounts[0].privateKey,
      zkAppPrivateKey
    );

    // if the transaction was successful, we can update our off-chain storage as well
    account.tickets = account.tickets.add(1);
    Tree.setLeaf(index, account.hash());
    await generateQr(zkAppPrivateKey.toPublicKey(), account, 0n, doQr);

    zkAppInstance.commitment.get().assertEquals(Tree.getRoot());

    // SEND TICKET part
    let fromAccount = Accounts.get('Alice')!;
    let toAccount = Accounts.get('Bob')!;
    let indexFrom = 0n;
    let indexTo = 1n;

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

    // send ticket tx
    await sendTicket(
      deployerAccount,
      zkAppInstance,
      fromAccount,
      witnessFrom,
      toAccount,
      witnessTo,
      testAccounts[0].privateKey,
      zkAppPrivateKey
    );

    // update off chain state
    fromAccount.tickets = fromAccount.tickets.sub(1);
    fromAccount.transferred = fromAccount.transferred.add(1);
    toAccount.tickets = toAccount.tickets.add(1);
    Tree.setLeaf(indexTo, toAccount.hash());
    await generateQr(zkAppPrivateKey.toPublicKey(), toAccount, 0n, doQr);
    // verify update was correct
    zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
  });

  it('can prove account owns a ticket', async () => {
    const zkAppInstance = await deployZKEvent(
      zkAppAddress,
      zkAppPrivateKey,
      deployerAccount,
      initialCommitment
    );

    let account = Accounts.get('Alice')!;
    let index = 0n;
    let w = Tree.getWitness(index);
    let witness = new MyMerkleWitness(w);

    await claimTicket(
      deployerAccount,
      zkAppInstance,
      account,
      witness,
      testAccounts[0].privateKey,
      zkAppPrivateKey
    );

    // if the transaction was successful, we can update our off-chain storage as well
    account.tickets = account.tickets.add(1);
    Tree.setLeaf(index, account.hash());
    await generateQr(zkAppPrivateKey.toPublicKey(), account, 0n, doQr);

    // PROVE OWNERSHIP OF TICKET(S)
    // from QR we get event contract address, account data and merkle witness index
    const givenEventAddress = zkAppPrivateKey.toPublicKey();
    const givenAccount = account;
    const givenIndex = 0n;
    const treeCopy = Tree;
    // check event address is correct
    zkAppInstance.address.assertEquals(givenEventAddress);
    // check user has more than one ticket (or they cant enter the event!)
    account.tickets.assertGte(UInt32.from(1));
    // check user account hashes to merkle tree leaf
    treeCopy.setLeaf(givenIndex, givenAccount.hash());
    treeCopy.getRoot().assertEquals(Tree.getRoot());
    // check computed root equals contract-stored root
    treeCopy.getRoot().assertEquals(zkAppInstance.commitment.get());
  });
});

function createLocalBlockchain() {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  return Local.testAccounts;
}

async function sendTx(tx: any, prove: boolean = false) {
  // very slow on M1 macs
  if (prove) {
    await tx.prove();
  }
  await tx.send();
}

async function deployZKEvent(
  zkAppAddress: PublicKey,
  zkAppPrivateKey: PrivateKey,
  deployerAccount: PrivateKey,
  initialCommitment: Field
) {
  const zkAppInstance = new ZKEvent(zkAppAddress);
  let tx = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount, { initialBalance });
    zkAppInstance.deploy({ zkappKey: zkAppPrivateKey });
    zkAppInstance.sign(zkAppPrivateKey);
  });
  await sendTx(tx);

  tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.setup(
      initialCommitment,
      UInt32.from(maxTicketsPerEvent),
      UInt32.from(maxNumberOfTicketsPerAccount),
      UInt64.from(Date.now() + 3600 * 1000 * 24),
      deployerAccount
    );
    zkAppInstance.sign(zkAppPrivateKey);
  });
  await sendTx(tx);
  return zkAppInstance;
}

async function claimTicket(
  deployerAccount: PrivateKey,
  zkAppInstance: ZKEvent,
  account: Account,
  witness: MyMerkleWitness,
  pkey: PrivateKey,
  zkAppPrivateKey: PrivateKey
) {
  let tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.claimTicket(account, witness, pkey);
    if (!doProofs) zkAppInstance.sign(zkAppPrivateKey);
  });
  await sendTx(tx, doProofs);
}

async function sendTicket(
  deployerAccount: PrivateKey,
  zkAppInstance: ZKEvent,
  fromAccount: Account,
  witnessFrom: MyMerkleWitness,
  toAccount: Account,
  witnessTo: MyMerkleWitness,
  pkey: PrivateKey,
  zkAppPrivateKey: PrivateKey
) {
  let tx = await Mina.transaction(deployerAccount, () => {
    zkAppInstance.sendTicket(
      fromAccount,
      witnessFrom,
      toAccount,
      witnessTo,
      pkey
    );
    if (!doProofs) zkAppInstance.sign(zkAppPrivateKey);
  });
  await sendTx(tx, doProofs);
}
