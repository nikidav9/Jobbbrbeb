import React, { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { registerConfirmHost, ConfirmRequest } from '@/services/confirm';

/** Единственное окно вопросов для `confirmAsync` на вебе (см. services/confirm.ts). */
export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const current = useRef<ConfirmRequest | null>(null);

  useEffect(() => registerConfirmHost(next => {
    // Новый вопрос поверх неотвеченного: прежний считается отказом, а не
    // висит обещанием, которое никто не разрешит.
    current.current?.resolve(false);
    current.current = next;
    setReq(next);
  }), []);

  const answer = (ok: boolean) => {
    const r = current.current;
    current.current = null;
    setReq(null);
    r?.resolve(ok);
  };

  return (
    <ConfirmDialog
      visible={!!req}
      title={req?.title ?? ''}
      body={req?.body ?? ''}
      confirmLabel={req?.confirmLabel}
      cancelLabel={req?.cancelLabel}
      danger={req?.danger}
      onCancel={() => answer(false)}
      onConfirm={() => answer(true)}
    />
  );
}
