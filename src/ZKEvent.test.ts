import { ZKEvent, Account, whitelistSize } from './ZKEvent';
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

import { MerkleTree } from 'snarkyjs/dist/node/lib/merkle_tree.js';

import QRCode from 'qrcode';

type Names = 'Alice' | 'Bob' | 'Carol' | 'Dave';

let maxNumberOfTicketsPerAccount = 2;
let maxTicketsPerEvent = 100;
export const initialBalance = 10_000_000_000;

// very slow on M1 macs if enabled
const doProofs = false;
// generate QR code in terminal
const doQr = false;

class MerkleWitness extends Experimental.MerkleWitness(whitelistSize) {}

function createLocalBlockchain() {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  return Local.testAccounts;
}

async function localDeploy(
  zkAppInstance: ZKEvent,
  zkAppPrivatekey: PrivateKey,
  deployerAccount: PrivateKey
) {
  const txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount, { initialBalance });
    zkAppInstance.deploy({ zkappKey: zkAppPrivatekey });
    zkAppInstance.sign(zkAppPrivatekey);
  });
  await txn.send().wait();
}

describe('ZKEvent', () => {
  let deployerAccount: PrivateKey,
    zkAppPrivateKey: PrivateKey,
    zkAppAddress: PublicKey,
    Accounts: Map<string, Account> = new Map<Names, Account>(),
    Tree: MerkleTree,
    initialCommitment: Field;

  beforeEach(async () => {
    await isReady;
    let testAccounts = createLocalBlockchain();
    deployerAccount = testAccounts[0].privateKey;
    let alice = new Account(testAccounts[0].publicKey, UInt32.from(0));
    let bob = new Account(testAccounts[1].publicKey, UInt32.from(0));
    let carol = new Account(testAccounts[2].publicKey, UInt32.from(0));
    let dave = new Account(testAccounts[3].publicKey, UInt32.from(0));
    Accounts.set('Alice', alice);
    Accounts.set('Bob', bob);
    Accounts.set('Carol', carol);
    Accounts.set('Dave', dave);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    Tree = new Experimental.MerkleTree(whitelistSize);
    Tree.setLeaf(0n, alice.hash());
    Tree.setLeaf(1n, bob.hash());
    Tree.setLeaf(2n, carol.hash());
    Tree.setLeaf(3n, dave.hash());
    Tree;
    initialCommitment = Tree.getRoot();
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  it('generates and deploys the `ZKEvent` smart contract', async () => {
    const zkAppInstance = new ZKEvent(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
  });

  it('correctly sets up the `ZKEvent`', async () => {
    const zkAppInstance = new ZKEvent(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    const txn = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.setup(
        initialCommitment,
        UInt32.fromNumber(maxTicketsPerEvent),
        UInt32.fromNumber(maxNumberOfTicketsPerAccount)
      );
      zkAppInstance.sign(zkAppPrivateKey);
    });
    await txn.send().wait();

    const state = zkAppInstance.isReady.get();
    expect(state).toEqual(UInt32.fromNumber(1));
  });

  it('allows claiming a ticket if a user is whitelisted', async () => {
    const zkAppInstance = new ZKEvent(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    const txn = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.setup(
        initialCommitment,
        UInt32.fromNumber(maxTicketsPerEvent),
        UInt32.fromNumber(maxNumberOfTicketsPerAccount)
      );
      zkAppInstance.sign(zkAppPrivateKey);
    });
    await txn.send().wait();

    console.log('Alice initial tickets: ' + Accounts.get('Alice')?.tickets);
    console.log('Alice is claiming a ticket..');
    let account = Accounts.get('Alice')!;
    let index = 0n;
    let w = Tree.getWitness(index);
    let witness = new MerkleWitness(w);

    let tx = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.claimTicket(account, witness);
      if (!doProofs) zkAppInstance.sign(zkAppPrivateKey);
    });
    // very slow on M1 macs
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

    zkAppInstance.commitment.get().assertEquals(Tree.getRoot());
    console.log('Alice final tickets: ' + Accounts.get('Alice')?.tickets);
  });

  it('can verify account owns a ticket', async () => {
    const zkAppInstance = new ZKEvent(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    const txn = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.setup(
        initialCommitment,
        UInt32.fromNumber(maxTicketsPerEvent),
        UInt32.fromNumber(maxNumberOfTicketsPerAccount)
      );
      zkAppInstance.sign(zkAppPrivateKey);
    });
    await txn.send().wait();
    let account = Accounts.get('Alice')!;
    let index = 0n;
    let w = Tree.getWitness(index);
    let witness = new MerkleWitness(w);

    let tx = await Mina.transaction(deployerAccount, () => {
      zkAppInstance.claimTicket(account, witness);
      if (!doProofs) zkAppInstance.sign(zkAppPrivateKey);
    });
    // very slow on M1 macs
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

    let root = zkAppInstance.commitment.get();
    root.assertEquals(Tree.getRoot());
    account.tickets.assertGte(UInt32.fromNumber(1));
  });
});
