'use client';

import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import Keycloak, { KeycloakInstance } from 'keycloak-js';
import { isRetryableStatus, retryDelayMs, validateMeetingDrafts } from './portal.logic';
import type { paths } from './api.generated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settlementDraftSchema } from './portal.schema';
import { useForm } from 'react-hook-form';

type Props = { role: 'owner' | 'backoffice_employee' };
type Row = { id: string; status: string; approvedTotal?: string | null; createdAt: string };
type Detail = {
  request: Row;
  meetings: { id: string; settlementDocumentId?: string | null }[];
  fees?: { amount: string; meetingId: string }[];
};
type Notice = {
  id: string;
  title: string;
  body: string;
  readAt?: string | null;
  createdAt: string;
};
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

export default function Portal({ role }: Props) {
  const { register } = useForm<{ crn: string }>({ mode: 'onBlur' });
  const crnField = register('crn');
  const [client, setClient] = useState<KeycloakInstance>();
  const [rows, setRows] = useState<Row[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [fee, setFee] = useState('100');
  const [crn, setCrn] = useState('');
  const [meetings, setMeetings] = useState([{ meetingAt: '', capital: '', documentId: '' }]);
  const [message, setMessage] = useState('Sign in to load live records.');
  const [notifications, setNotifications] = useState<Notice[]>([]);
  const queryClient = useQueryClient();

  useEffect(() => {
    const kc = new Keycloak({
      url: process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? 'http://localhost:8080',
      realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? 'mcdr',
      clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? 'mcdr-web',
    });
    setClient(kc);
    kc.init({
      onLoad: 'check-sso',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      silentCheckSsoFallback: false,
      responseMode: 'query',
      pkceMethod: 'S256',
      checkLoginIframe: false,
    })
      .then((ok) => {
        setMessage(ok ? 'Connected securely.' : 'Sign in to load live records.');
      })
      .catch(() => setMessage('Identity service is unavailable.'));
  }, []);

  const MAX_RETRIES = 3;
  async function authFetch(
    path: keyof paths | (string & {}),
    init?: RequestInit,
    attempt = 0,
  ): Promise<Response> {
    if (!client?.authenticated) {
      await client?.login();
      throw new Error('Authentication required');
    }
    await client.updateToken(30);
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${client.token}`, ...(init?.headers ?? {}) },
    });
    if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
      return authFetch(path, init, attempt + 1);
    }
    return response;
  }
  const notificationQuery = useQuery({
    queryKey: ['notifications', role],
    enabled: Boolean(client?.authenticated),
    queryFn: async () => {
      const response = await authFetch('/notifications');
      if (!response.ok) throw new Error('Notifications unavailable');
      const body = await response.json();
      return (body.data?.items ?? body.data ?? []) as Notice[];
    },
  });
  useEffect(() => {
    if (notificationQuery.data) setNotifications(notificationQuery.data);
  }, [notificationQuery.data]);
  async function loadRequests() {
    try {
      const response = await authFetch(
        role === 'owner' ? '/settlement-requests' : '/backoffice/settlement-requests',
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      setRows(body.data?.items ?? body.data ?? []);
      setMessage('Live data refreshed.');
    } catch {
      setMessage('Could not load requests.');
    }
  }
  async function markNotificationRead(id: string) {
    const response = await authFetch(`/notifications/${id}/read`, { method: 'PATCH' });
    if (response.ok) {
      setNotifications((items) =>
        items.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ['notifications', role] });
    }
  }
  async function checkEligibility(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await authFetch(
        `/companies/${encodeURIComponent(crn)}/settlement-eligibility`,
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      setMessage(
        body.data?.settlementRequired
          ? 'Settlement is required.'
          : 'No settlement is currently required.',
      );
    } catch {
      setMessage('Eligibility lookup failed.');
    }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>, index = 0) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await authFetch('/backoffice/meetings/meeting-attachment', {
        method: 'POST',
        body: form,
      });
      const body = await response.json();
      if (!response.ok) throw new Error();
      setMeetings((items) =>
        items.map((item, itemIndex) =>
          itemIndex === index ? { ...item, documentId: body.data.documentId } : item,
        ),
      );
      setMessage('Attachment scanned and approved.');
    } catch {
      setMessage('Attachment was rejected.');
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validationError = validateMeetingDrafts(meetings);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const parsed = settlementDraftSchema.safeParse({ crn, meetings });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? 'Please correct the request details.');
      return;
    }
    try {
      const response = await authFetch('/settlement-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crn,
          meetings: meetings.map((meeting) => ({
            meetingAt: meeting.meetingAt,
            capital: Number(meeting.capital),
            attachmentDocumentId: meeting.documentId,
          })),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined);
        throw new Error(body?.error?.message ?? 'Request could not be submitted.');
      }
      setMessage('Request submitted for review.');
      await loadRequests();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request could not be submitted.');
    }
  }
  async function openDetail(id: string) {
    const response = await authFetch(`/backoffice/settlement-requests/${id}`);
    const body = await response.json();
    setDetail(body.data);
  }
  async function decide(id: string, approve: boolean) {
    const response = await authFetch(
      `/backoffice/settlement-requests/${id}/${approve ? 'approve' : 'reject'}`,
      {
        method: 'POST',
        ...(approve
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason: 'Evidence did not meet review requirements.' }),
            }),
      },
    );
    setMessage(
      response.ok
        ? approve
          ? 'Request approved.'
          : 'Request rejected.'
        : 'Decision was not accepted.',
    );
    await loadRequests();
  }
  async function setFees() {
    if (!detail) return;
    const response = await authFetch(`/backoffice/settlement-requests/${detail.request.id}/fees`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fees: detail.meetings.map((meeting) => ({ meetingId: meeting.id, amount: Number(fee) })),
      }),
    });
    setMessage(response.ok ? 'Fees saved.' : 'Fees could not be saved.');
  }
  async function uploadSettlement(meetingId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    const response = await authFetch(`/backoffice/meetings/${meetingId}/settlement-document`, {
      method: 'POST',
      body: form,
    });
    setMessage(response.ok ? 'Settlement document uploaded.' : 'Settlement document was rejected.');
    if (response.ok) await openDetail(detail!.request.id);
  }
  async function pay(id: string) {
    const idempotencyKey = crypto.randomUUID();
    const response = await authFetch(`/settlement-requests/${id}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ idempotencyKey }),
    });
    setMessage(response.ok ? 'Payment simulated successfully.' : 'Payment was not accepted.');
    await loadRequests();
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">MCDR / SETTLEMENTS</span>
          <h1>{role === 'owner' ? 'Owner workspace' : 'Review desk'}</h1>
        </div>
        <button
          className="ghost"
          onClick={() => (client?.authenticated ? client.logout() : client?.login())}
        >
          {client?.authenticated ? 'Account' : 'Sign in'}
        </button>
      </header>
      <section className="hero">
        <div>
          <span className="eyebrow">SECURE SERVICE CONSOLE</span>
          <h2>
            {role === 'owner'
              ? 'Move historic meetings toward closure.'
              : 'Keep every request moving with confidence.'}
          </h2>
          <p>
            {role === 'owner'
              ? 'Check eligibility, submit meeting records, and follow payment and settlement status.'
              : 'Review evidence, set transparent fees, and finish each settlement with an auditable document trail.'}
          </p>
          <button className="primary" onClick={loadRequests}>
            Refresh workspace <span>↗</span>
          </button>
        </div>
        <div className="orb" aria-hidden="true">
          <span>01</span>
          <b>{role === 'owner' ? 'OWNER' : 'BACKOFFICE'}</b>
        </div>
      </section>
      <section className="panel notifications" aria-labelledby="notifications-title">
        <div className="panel-title">
          <div>
            <span className="eyebrow">INBOX</span>
            <h3 id="notifications-title">Notifications</h3>
          </div>
          <span className="status-dot">
            ● {notifications.filter((item) => !item.readAt).length} unread
          </span>
        </div>
        {notifications.length ? (
          notifications.slice(0, 10).map((item) => (
            <article className={`notice ${item.readAt ? '' : 'unread'}`} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
              {!item.readAt ? (
                <button className="small" onClick={() => markNotificationRead(item.id)}>
                  Mark read
                </button>
              ) : null}
            </article>
          ))
        ) : (
          <div className="empty">
            <p>No notifications yet.</p>
          </div>
        )}
      </section>
      {role === 'owner' ? (
        <section className="forms">
          <form className="card" onSubmit={checkEligibility}>
            <span className="eyebrow">ELIGIBILITY</span>
            <h3>Check a CRN</h3>
            <label htmlFor="crn">Commercial Registration Number</label>
            <input
              {...crnField}
              id="crn"
              value={crn}
              onChange={(event) => {
                void crnField.onChange(event);
                setCrn(event.target.value);
              }}
              required
            />
            <button className="primary" type="submit">
              Check status
            </button>
          </form>
          <form className="card" onSubmit={submit}>
            <span className="eyebrow">NEW REQUEST</span>
            <h3>Add a meeting</h3>
            {meetings.map((meeting, index) => (
              <fieldset className="meeting" key={index}>
                <legend>Meeting {index + 1}</legend>
                <label htmlFor={`meetingAt-${index}`}>Meeting date and time</label>
                <input
                  id={`meetingAt-${index}`}
                  type="datetime-local"
                  value={meeting.meetingAt}
                  onChange={(e) =>
                    setMeetings((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, meetingAt: e.target.value } : item,
                      ),
                    )
                  }
                  required
                />
                <label htmlFor={`capital-${index}`}>Capital at meeting</label>
                <input
                  id={`capital-${index}`}
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={meeting.capital}
                  onChange={(e) =>
                    setMeetings((items) =>
                      items.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, capital: e.target.value } : item,
                      ),
                    )
                  }
                  required
                />
                <label htmlFor={`attachment-${index}`}>Attachment (PDF, PNG, JPEG; max 10MB)</label>
                <input
                  id={`attachment-${index}`}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(e) => upload(e, index)}
                  required={!meeting.documentId}
                />
                <small>
                  {meeting.documentId
                    ? `Approved document: ${meeting.documentId.slice(0, 8)}`
                    : 'Upload is scanned before submission.'}
                </small>
                {meetings.length > 1 ? (
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      setMeetings((items) => items.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    Remove meeting
                  </button>
                ) : null}
              </fieldset>
            ))}
            {meetings.length < 20 ? (
              <button
                className="ghost"
                type="button"
                onClick={() =>
                  setMeetings((items) => [...items, { meetingAt: '', capital: '', documentId: '' }])
                }
              >
                + Add meeting
              </button>
            ) : null}
            <button className="primary" type="submit">
              Submit request
            </button>
          </form>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-title">
          <div>
            <span className="eyebrow">{role === 'owner' ? 'MY REQUESTS' : 'QUEUE'}</span>
            <h3>Settlement activity</h3>
          </div>
          <span className="status-dot">● {message}</span>
        </div>
        {rows.length ? (
          <div className="rows">
            {rows.map((row) => (
              <article className="row" key={row.id}>
                <span className="mono">{row.id.slice(0, 8)}</span>
                <strong>{row.status.replaceAll('_', ' ')}</strong>
                <span>{row.approvedTotal ? `${row.approvedTotal} EGP` : 'Fee pending'}</span>
                <time>{new Date(row.createdAt).toLocaleDateString()}</time>
                {role === 'owner' && row.status === 'AWAITING_PAYMENT' ? (
                  <button className="small" onClick={() => pay(row.id)}>
                    Pay
                  </button>
                ) : null}
                {role !== 'owner' ? (
                  <button className="small" onClick={() => openDetail(row.id)}>
                    Open
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="empty">
            <span>◎</span>
            <p>No requests loaded yet.</p>
            <small>Authenticate, then refresh to see your protected workspace.</small>
          </div>
        )}
      </section>
      {detail ? (
        <section className="card detail">
          <span className="eyebrow">REQUEST {detail.request.id.slice(0, 8)}</span>
          <h3>{detail.request.status.replaceAll('_', ' ')}</h3>
          <p>
            {detail.meetings.length} meeting(s) · {detail.fees?.length ?? 0} fee(s)
          </p>
          {detail.request.status === 'UNDER_REVIEW' ? (
            <div className="actions">
              <label htmlFor="fee">Fee per meeting (EGP)</label>
              <input
                id="fee"
                type="number"
                min="0.01"
                step="0.01"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
              />
              <button className="small" onClick={setFees}>
                Save fees
              </button>
              <button className="primary" onClick={() => decide(detail.request.id, true)}>
                Approve
              </button>
              <button className="ghost" onClick={() => decide(detail.request.id, false)}>
                Reject
              </button>
            </div>
          ) : null}
          {role === 'backoffice_employee' &&
          ['PAID', 'PARTIALLY_SETTLED'].includes(detail.request.status) ? (
            <div className="meeting-documents">
              <h4>Settlement documents</h4>
              {detail.meetings.map((meeting, index) => (
                <label key={meeting.id} htmlFor={`settlement-${meeting.id}`}>
                  Meeting {index + 1}: {meeting.settlementDocumentId ? 'uploaded' : 'pending'}
                  {!meeting.settlementDocumentId ? (
                    <input
                      id={`settlement-${meeting.id}`}
                      type="file"
                      accept="application/pdf,image/png,image/jpeg"
                      onChange={(event) => uploadSettlement(meeting.id, event)}
                    />
                  ) : null}
                </label>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
