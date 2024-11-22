'use server'

/* @malted says:
 * Hi! Welcome to `data.ts` :)
 * These are critical functions primarily used by `middleware.ts`.
 *
 * If you need the user's ships for example, you should not be here.
 * You should instead use the cookie, which is set by `middleware.ts`.
 *
 * Do not use any libraries here.
 * This module is imported into the Vercel edge runtime
 * You've been warned.
 */

import { getSession, type HsSession } from './auth'
import { createWaka } from './waka'
import { cookies } from 'next/headers'

//#region Ships
export type ShipType = 'project' | 'update'
export type ShipStatus = 'shipped' | 'staged' | 'deleted'
export interface Ship {
  id: string // The Airtable row's ID.
  title: string
  repoUrl: string
  deploymentUrl?: string
  readmeUrl: string
  screenshotUrl: string
  // doubloonsPaid?: number;
  matchups_count: number
  hours: number | null
  credited_hours: number | null
  total_hours: number | null
  voteRequirementMet: boolean
  voteBalanceExceedsRequirement: boolean
  doubloonPayout: number
  shipType: ShipType
  shipStatus: ShipStatus
  wakatimeProjectNames: string[]
  createdTime: string
  updateDescription: string | null
  reshippedFromId: string | null
  reshippedToId: string | null
  reshippedAll: string[] | null
  reshippedFromAll: string[] | null
  paidOut: boolean
}

export async function fetchShips(
  slackId: string,
  maxRecords: null | number = null,
): Promise<Ship[]> {
  const realSlackId = await getSession().then((d) => d?.slackId)

  if (!realSlackId || realSlackId !== slackId) return []

  const filterFormula = `AND(
    TRUE(),
    '${slackId}' = {entrant__slack_id},
    {project_source} = 'high_seas',
    {ship_status} != 'deleted'
  )`

  let url = `https://middleman.hackclub.com/airtable/v0/appTeNFYcUiYfGcR6/ships?filterByFormula=${encodeURIComponent(
    filterFormula,
  )}`
  if (maxRecords != null) url += `&maxRecords=${maxRecords}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'highseas.hackclub.com (fetchShips)',
    },
  }).then((data) => data.json())

  return res.records.map((r: { fields: any; id: string }) => {
    const reshippedToIdRaw = r.fields.reshipped_to as [string] | null
    const reshippedToId = reshippedToIdRaw ? reshippedToIdRaw[0] : null

    const reshippedFromIdRaw = r.fields.reshipped_from as [string] | null
    const reshippedFromId = reshippedFromIdRaw ? reshippedFromIdRaw[0] : null
    const reshippedAll = r.fields.reshipped_all as [string] | null
    const reshippedFromAll = r.fields.reshipped_from_all as [string] | null

    const wakatimeProjectNameRaw = r.fields.wakatime_project_name as
      | string
      | null
    const wakatimeProjectNames = wakatimeProjectNameRaw
      ? wakatimeProjectNameRaw.split('$$xXseparatorXx$$')
      : []

    const ship: Ship = {
      id: r.id,
      title: r.fields.title,
      repoUrl: r.fields.repo_url,
      deploymentUrl: r.fields.deploy_url,
      readmeUrl: r.fields.readme_url,
      screenshotUrl: r.fields.screenshot_url,
      voteRequirementMet: Boolean(r.fields.vote_requirement_met),
      voteBalanceExceedsRequirement: Boolean(
        r.fields.vote_balance_exceeds_requirement,
      ),
      matchups_count: r.fields.matchups_count,
      doubloonPayout: r.fields.doubloon_payout,
      shipType: r.fields.ship_type,
      shipStatus: r.fields.ship_status,
      wakatimeProjectNames,
      hours: r.fields.hours,
      credited_hours: r.fields.credited_hours,
      total_hours: r.fields.total_hours,
      createdTime: r.fields.created_time,
      updateDescription: r.fields.update_description,
      reshippedFromId,
      reshippedToId,
      reshippedAll,
      reshippedFromAll,
      paidOut: Boolean(r.fields.paid_out),
    }

    return ship
  })
}
//#endregion

//#region Person
const personCacheTtl = 60_000
const personCache = new Map()
export async function person(): Promise<any> {
  const session = await getSession()
  if (!session) throw new Error('No session present')

  const cached = personCache.get(session.personId)
  if (cached) {
    const [data, timestamp] = cached
    if (Date.now() < timestamp + personCacheTtl) {
      console.log('Person cache HIT')
      return data
    }
    personCache.delete(session.personId)
  }
  console.log('Person cache MISS')

  const response = await fetch(
    `https://middleman.hackclub.com/airtable/v0/appTeNFYcUiYfGcR6/people/${session.personId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
        'User-Agent': 'highseas.hackclub.com (person)',
      },
    },
  )

  if (!response.ok) throw new Error('Failed to fetch person')
  const record = await response.json()
  if (!record) throw new Error('Person not found')

  personCache.set(session.personId, [record, Date.now()])
  return record
}
//#endregion

//#region Wakatime
export async function hasHbData(username: string): Promise<boolean> {
  const res = await fetch(
    `https://waka.hackclub.com/api/special/hasData/?user=${encodeURIComponent(
      username,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.WAKA_API_KEY}`,
        accept: 'application/json',
      },
    },
  ).then((res) => res.json())

  return res.hasData
}
export async function fetchWaka(session: HsSession): Promise<{
  username: string
  key: string
  hasHb: boolean
}> {
  const { slack_id, email, full_name, preexisting_user } = await person()
    .then((p) => p.fields)
    .catch(console.error)

  const { username, key } = await createWaka(
    email,
    preexisting_user
      ? full_name
      : (session.name?.length ?? 0) > 0
        ? session.name
        : null,
    preexisting_user
      ? slack_id
      : session.slackId.length > 0
        ? session.slackId
        : null,
  )

  const hasHb = await hasHbData(username)

  return { username, key, hasHb }
}
//#endregion

//#region Signpost
export interface SignpostFeedItem {
  id: string
  createdTime: Date
  title: string
  content: string
  autonumber: number
  category: 'update' | 'announcement' | 'sale' | 'alert'
  backgroundColor: string
  textColor: string
}
export async function fetchSignpostFeed(): Promise<SignpostFeedItem[]> {
  const result = await fetch(
    'https://middleman.hackclub.com/airtable/v0/appTeNFYcUiYfGcR6/signpost',
    {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'User-Agent': 'highseas.hackclub.com (fetchSignpostFeed)',
      },
    },
  ).then((d) => d.json())

  const records = result.records

  //TODO: Pagination.
  return records
    .filter((r: { fields: { visible: boolean } }) => r.fields.visible === true)
    .map(
      (r: {
        id: string
        createdTime: string
        fields: {
          title: string
          content: string
          autonumber: number
          category: string
          background_color: string
          text_color: string
        }
      }) => ({
        id: r.id,
        createdTime: new Date(r.createdTime),
        title: r.fields.title,
        content: r.fields.content,
        autonumber: Number(r.fields.autonumber),
        category: r.fields.category,
        backgroundColor: r.fields.background_color,
        textColor: r.fields.text_color,
      }),
    )
}
//#endregion

//#region Shop
export interface ShopItem {
  id: string
  name: string
  subtitle: string | null
  imageUrl: string | null
  enabledUs: boolean
  enabledEu: boolean
  enabledIn: boolean
  enabledXx: boolean
  enabledCa: boolean
  priceUs: number
  priceGlobal: number
  fulfilledAtEnd: boolean
  comingSoon: boolean
  outOfStock: boolean
  minimumHoursEstimated: number
  maximumHoursEstimated: number
}
export async function fetchShopItems(): Promise<ShopItem[]> {
  const result = await fetch(
    'https://middleman.hackclub.com/airtable/v0/appTeNFYcUiYfGcR6/shop_items',
    {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'User-Agent': 'highseas.hackclub.com (fetchShopItems)',
      },
    },
  ).then((d) => d.json())

  //TODO: Pagination.
  return result.records
    .filter((r: { fields: { enabled: boolean } }) => r.fields.enabled === true)
    .map(({ id, fields }: any) => ({
      id,
      name: fields.name,
      subtitle: fields.subtitle,
      imageUrl: fields.image_url,
      enabledUs: fields.enabled_us === true,
      enabledEu: fields.enabled_eu === true,
      enabledIn: fields.enabled_in === true,
      enabledXx: fields.enabled_xx === true,
      enabledCa: fields.enabled_ca === true,
      priceUs: fields.tickets_us,
      priceGlobal: fields.tickets_global,
      fulfilledAtEnd: fields.fulfilled_at_end === true,
      comingSoon: fields.coming_soon === true,
      outOfStock: fields.out_of_stock === true,
      minimumHoursEstimated: fields.minimum_hours_estimated,
      maximumHoursEstimated: fields.maximum_hours_estimated,
    }))
}
//#endregion
