import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { withTestDb, seedGuestSession, seedOrganizer } from '../helpers/database';
import type { AcceptInput } from '@/features/wedding/types';
const acceptedInput = (overrides:Partial<AcceptInput>={}):AcceptInput => ({decision:'accept',contact:{fullName:'Asha Jain',whatsapp:'+12025550123'},guestNames:['Asha Jain','Ravi Jain','Neha Jain'],eventIds:['haldi'],travel:{arrivalDate:'2027-02-12',arrivalWindow:'noon-5pm',departureDate:'2027-02-14',departureWindow:'before-noon'},...overrides});
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const origin='http://127.0.0.1:3200';
test('launch journey connects group authorization, three saved guests, edit/reload, live metrics and private exports',async({page})=>{
  await withTestDb(async db=>{
    const guest=await seedGuestSession('group-2',db),organizer=await seedOrganizer(db);
    await page.context().addCookies([{name:'wedding_guest',value:guest.cookie,url:origin}]);
    await page.goto('/invitation?opened=1');await expect(page.locator('[data-event-id]')).toHaveCount(6);
    await page.goto('/rsvp');
    const token=randomBytes(32).toString('base64url');
    const command={requestId:randomUUID(),editToken:token,response:acceptedInput({eventIds:['mehendi']})};
    const send=(data:unknown)=>page.request.post('/api/rsvp',{headers:{Origin:origin},data});
    expect((await send(command)).status()).toBe(422);
    command.response=acceptedInput();const saved=await send(command);expect(saved.status()).toBe(200);
    const id=(await saved.json()).id;
    expect(await db`select full_name from wedding.rsvp_guests where submission_id=${id}`).toHaveLength(3);
    const metrics=async()=>{const r=await page.request.get('/api/admin/metrics',{headers:{Cookie:organizer.cookieHeader}});expect(r.status()).toBe(200);return r.json();};
    expect(await metrics()).toMatchObject({acceptingSubmissions:1,attendingGuests:3,guestNights:6,eventGuests:{haldi:3}});
    await page.goto(`/rsvp/edit#${token}`);
    await expect(page.getByRole('textbox',{name:'Full name',exact:true})).toHaveValue('Asha Jain');await page.reload();
    await page.getByRole('button',{name:'Next',exact:true}).click();
    await expect(page.getByRole('textbox',{name:/Guest.*full name/})).toHaveCount(3);
    for(const field of await page.getByRole('textbox',{name:/Guest.*full name/}).all())await expect(field).toHaveAttribute('required','');
    await page.getByRole('combobox',{name:'Number of guests'}).selectOption('1');
    for(let i=0;i<3;i++)await page.getByRole('button',{name:'Next',exact:true}).click();
    await page.getByRole('button',{name:'Save changes'}).click();
    await expect(page.getByRole('heading',{name:'Your response is saved.'})).toBeVisible();await page.reload();
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(1);
    expect(await db`select full_name from wedding.rsvp_guests`).toHaveLength(1);
    expect(await metrics()).toMatchObject({acceptingSubmissions:1,attendingGuests:1,guestNights:2,eventGuests:{haldi:1}});
    expect((await page.request.get('/api/admin/exports/guests')).status()).toBe(401);
    const exported=await page.request.get('/api/admin/exports/guests',{headers:{Cookie:organizer.cookieHeader}});
    expect(exported.status()).toBe(200);expect(exported.headers()['cache-control']).toContain('no-store');expect(await exported.text()).toContain('Asha Jain');
    await page.goto('/admin');await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
test('2027 fixture layout, keyboard, upright Hindi and eight responsive evidence captures',async({page,browser},info)=>{
  test.setTimeout(120_000);
  await withTestDb(async db=>{
    // Public synthetic names remain synthetic; this focused date fixture models the approved year.
    await db`update wedding.website_content set wedding=jsonb_set(jsonb_set(wedding,'{startDate}','"2027-02-12"'),'{endDate}','"2027-02-14"')`;
    await db`update wedding.events set start_at=start_at-interval '3 years',end_at=end_at-interval '3 years'`;
    const guest=await seedGuestSession('group-1',db);
    await page.context().addCookies([{name:'wedding_guest',value:guest.cookie,url:origin}]);
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/invitation');
    await page.getByRole('button',{name:'Open invitation',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(page.getByRole('button',{name:'Open invitation',exact:true})).toHaveCount(0);
    await expect(page.locator('[data-event-id]')).toHaveCount(8);
    await expect(page.getByTestId('wedding-date')).toHaveText(/12.*14 February 2027/);
    await expect(page.getByRole('link',{name:'Open map',exact:true})).toHaveAttribute('href','https://example.com/sample-venue');
    await expect(page.getByRole('link',{name:'Call',exact:true})).toHaveAttribute('href','tel:+12025550123');
    await expect(page.getByRole('link',{name:'WhatsApp',exact:true})).toHaveAttribute('href','https://wa.me/12025550123');
    await expect(page.locator('audio')).toHaveCount(0);
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const width of [320,390,768,1440]){
      await page.setViewportSize({width,height:900});
      for(const locale of ['en','hi']){
        await page.getByRole('button',{name:locale==='en'?'English':'हिन्दी',exact:true}).click();
        await page.getByRole('button',{name:locale==='en'?'Replay opening':'फिर से खोलें'}).click();
        await expect(page.getByRole('button',{name:locale==='en'?'Open invitation':'निमंत्रण खोलें',exact:true})).toHaveCount(0);
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        expect(await page.locator('h1').count()).toBe(1);
        await page.locator('a[href="/rsvp"]').focus();
        await expect(page.locator('a[href="/rsvp"]')).toBeFocused();
        await page.evaluate(()=>window.scrollTo(0,0));
        if(locale==='hi')expect(await page.locator('header a[href="#welcome"]').last().evaluate(e=>getComputedStyle(e).fontStyle)).toBe('normal');
        await page.screenshot({path:info.outputPath(`invitation-${locale}-${width}.png`),fullPage:true});
      }
    }
    expect(errors).toEqual([]);
    await mkdir('test-results',{recursive:true});await writeFile(`test-results/browser-${info.project.name}.json`,JSON.stringify({engine:info.project.name,version:browser.version(),physicalDevice:false,widths:[320,390,768,1440],locales:['en','hi'],dateFixture:2027,officialLogoPixels:'UNVERIFIED — placeholder only'}));
  });
});
