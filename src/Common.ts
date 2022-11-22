import { Field, PublicKey } from 'snarkyjs';

import { Account } from './ZKEvent';

import QRCode from 'qrcode';

export async function generateQr(
  event: PublicKey,
  account: Account,
  index: BigInt,
  doQr: boolean
) {
  const data = {
    event: event.toString(),
    pubKey: account.publicKey.toString(),
    tickets: account.tickets.toString(),
    transferred: account.transferred.toString(),
    index: index.toString(),
  };
  if (doQr) {
    QRCode.toString(
      JSON.stringify(data),
      { type: 'terminal' },
      function (err, url) {
        console.log(url);
      }
    );
  }
}
