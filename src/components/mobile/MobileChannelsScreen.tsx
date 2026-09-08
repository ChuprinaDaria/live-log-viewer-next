"use client";

import { useState } from "react";

import { X } from "@/components/icons";
import { useLocale } from "@/lib/i18n";

import { MobileBarTitle, MobileShell, type MobileShellHost, type SheetRenderer } from "./MobileShell";
import { channelLine, channelTitle, useChannels, useTelegramAccounts, type Channel, type TelegramAccountRow } from "./channelsModel";
import { showReceipt } from "./MobileReceipt";
import { TelegramAccountSheet } from "./TelegramAccountSheet";

/*
 * Which chats each project listens to.
 *
 * The operator's own description of the flow: pick an account from the ones
 * already enrolled, paste a link to the chat, channel or group, and give it to
 * the right project. No chat ids are typed here — the collector resolves them,
 * so a fresh channel shows «not reached yet» rather than pretending it is
 * connected. That distinction is the whole reason the state is displayed.
 *
 * Only accounts that can actually read a chat appear in the picker. The ones
 * that cannot are listed below it with the console's reason, because «why is
 * my bot token not in the list» is a question worth answering once on screen
 * instead of every time it comes up.
 */

const CARD = "flex flex-col divide-y divide-border overflow-hidden rounded-surface border border-border bg-card";

function ChannelRow({ channel, onRemove }: { channel: Channel; onRemove: () => void }) {
  const { t } = useLocale();
  const where = channel.from ?? channel.owner ?? "";
  return (
    <div data-channel={channel.link} className="flex min-h-14 items-center gap-2 px-4 py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body font-semibold text-primary">{channelTitle(channel)}</span>
        <span className="truncate text-label text-muted">{channelLine(channel)}</span>
        <span className="truncate text-caption text-muted">
          {where ? `${where} · ` : ""}{channel.account}
        </span>
        {channel.resolved_at ? null : (
          <span className="truncate text-caption text-warning">{t("channels.unreached")}</span>
        )}
      </span>
      <button type="button" onClick={onRemove} aria-label={t("channels.disconnect", { name: channelTitle(channel) })}
        className="grid h-11 w-11 shrink-0 place-items-center text-muted active:text-danger">
        <X className="h-[18px] w-[18px]" aria-hidden />
      </button>
    </div>
  );
}

/**
 * One connected Telegram account, and the way out of it.
 *
 * «Вийти» acts on the first tap: no confirmation dialog (mobile README §2
 * rule 9), and the receipt is the answer. The remote authorization is revoked
 * and the local credential removed together — a refusal keeps both and says
 * which refusal it was.
 */
function AccountRow({ account, onSignOut }: { account: TelegramAccountRow; onSignOut: () => void }) {
  const { t } = useLocale();
  const who = account.username ? `@${account.username}` : account.name || account.phone || account.slug;
  return (
    <div data-telegram-account={account.slug} className="flex min-h-14 items-center gap-2 px-4 py-2">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body font-semibold text-primary">{who}</span>
        <span className="truncate text-label text-muted">{account.slug}{account.phone ? ` · ${account.phone}` : ""}</span>
        {/* The account exists locally but the picker above will not offer it:
            say why, here, rather than leave the absence unexplained. */}
        {account.vaultId === null && account.vaultReason ? (
          <span className="truncate text-caption text-warning">{t("telegram.vaultMissing", { reason: account.vaultReason })}</span>
        ) : null}
      </span>
      <button type="button" onClick={onSignOut} data-telegram-signout={account.slug}
        className="min-h-11 shrink-0 rounded-[12px] px-3 text-label font-semibold text-danger">
        {t("telegram.logout")}
      </button>
    </div>
  );
}

export function MobileChannelsScreen({ host, renderSheet }: { host: MobileShellHost | null; renderSheet?: SheetRenderer }) {
  const { t } = useLocale();
  const channels = useChannels();
  const telegram = useTelegramAccounts();
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState("");
  const [link, setLink] = useState("");
  const [account, setAccount] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = target.trim() && link.trim() && account;

  const connect = async () => {
    if (!ready || busy) return;
    setBusy(true);
    const failure = await channels.connect(target.trim(), link.trim(), account);
    setBusy(false);
    setProblem(failure);
    if (!failure) { setLink(""); }
  };

  return (
    <MobileShell screen="channels" title={<MobileBarTitle>{t("channels.title")}</MobileBarTitle>} host={host} renderSheet={renderSheet}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-3 py-3" data-mobile2-channels>
        {channels.error ? (
          <div role="status" className="flex flex-col gap-2 px-1 text-label text-danger">
            <p>{channels.error === "UNREACHABLE" ? t("list.failed") : channels.error}</p>
            <button type="button" onClick={() => void channels.refresh()} className="min-h-11 rounded-[12px] bg-card px-3">{t("list.retry")}</button>
          </div>
        ) : !channels.channels ? (
          <p role="status" className="px-1 text-label text-muted">{t("common.loading")}</p>
        ) : (
          <>
            {problem ? <p role="status" data-channel-problem className="px-1 text-label text-danger">{problem}</p> : null}

            <section className={`${CARD} p-3`}>
              <p className="pb-2 text-label font-semibold text-primary">{t("channels.addTitle")}</p>
              <input value={target} onChange={(event) => setTarget(event.target.value)}
                placeholder="project:money" aria-label={t("channels.addTarget")}
                className="min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary" />
              <input value={link} onChange={(event) => setLink(event.target.value)}
                placeholder="https://t.me/…" aria-label={t("channels.addLink")}
                className="mt-2 min-h-11 w-full rounded-[12px] border border-border bg-card px-3 text-body text-primary" />

              <p className="pt-3 pb-1 text-label font-semibold text-primary">{t("channels.account")}</p>
              {channels.usable.length === 0 ? (
                <p className="text-label text-warning">{t("channels.noAccounts")}</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {channels.usable.map((row) => (
                    <button key={row.id} type="button" onClick={() => setAccount(row.id)}
                      aria-pressed={account === row.id}
                      className={`min-h-11 w-full rounded-[12px] px-3 text-left text-label ${account === row.id ? "bg-accent text-white" : "bg-quiet text-secondary"}`}>
                      <span className="block truncate font-semibold">{row.label || row.id}</span>
                      <span className="block truncate text-caption opacity-80">{row.id}</span>
                    </button>
                  ))}
                </div>
              )}

              <button type="button" disabled={busy || !ready} onClick={() => void connect()}
                className="mt-3 min-h-11 w-full rounded-[12px] bg-accent px-3 text-label font-semibold text-white disabled:opacity-50">
                {t("channels.connect")}
              </button>

              {/* Why a token you can see is not in the list above. */}
              {channels.notUsable.length ? (
                <details className="pt-3">
                  <summary className="min-h-11 cursor-pointer text-label text-muted">{t("channels.notUsable", { count: channels.notUsable.length })}</summary>
                  <ul className="pt-1">
                    {channels.notUsable.map((row) => (
                      <li key={row.id} className="py-0.5 text-caption text-muted">
                        <span className="font-medium">{row.id}</span> — {row.why}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>

            <section className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 px-1">
                <h2 className="text-label font-semibold text-secondary">{t("telegram.accounts")}</h2>
                <button type="button" data-telegram-add onClick={() => setAdding(true)}
                  className="ml-auto min-h-11 rounded-[12px] px-2 text-label font-semibold text-accent">
                  {t("telegram.addAccount")}
                </button>
              </div>
              {telegram.accounts.length ? (
                <div className={CARD}>
                  {telegram.accounts.map((account) => (
                    <AccountRow key={account.slug} account={account}
                      onSignOut={() => void telegram.signOut(account.slug).then((refused) => {
                        setProblem(refused);
                        if (!refused) {
                          showReceipt(t("channels.disconnect", { name: account.username ? `@${account.username}` : account.slug }));
                          void channels.refresh();
                        }
                      })} />
                  ))}
                </div>
              ) : null}
            </section>

            {channels.channels.length === 0 ? (
              <p role="status" className="px-1 text-label text-muted">{t("channels.none")}</p>
            ) : (
              <section className="flex flex-col gap-1.5">
                <h2 className="flex items-center gap-1.5 px-1 text-label font-semibold text-secondary">
                  {t("channels.connected")}
                  <span className="text-caption font-semibold tabular-nums text-muted">{channels.channels.length}</span>
                </h2>
                <div className={CARD}>
                  {channels.channels.map((channel) => (
                    <ChannelRow key={`${channel.owner ?? ""}:${channel.link}`} channel={channel}
                      onRemove={() => {
                        const owner = channel.owner ?? channel.from;
                        if (!owner) return;
                        void channels.disconnect(owner, channel.link).then(setProblem);
                      }} />
                  ))}
                </div>
              </section>
            )}
            {adding ? (
              <TelegramAccountSheet
                onClose={() => setAdding(false)}
                onConnected={() => {
                  /* Both lists move: the new account appears here, and the
                     picker above re-reads `channel_accounts` so it can be
                     chosen for a chat without a page reload. */
                  void telegram.refresh();
                  void channels.refresh();
                }}
              />
            ) : null}
          </>
        )}
      </div>
    </MobileShell>
  );
}
