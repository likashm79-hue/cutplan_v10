import asyncio, re
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent

def source_html():
    page=(ROOT/'index.html').read_text()
    page=re.sub(r'<script src="https://[^"]+"></script>\s*','',page)
    for name in ('cutting-list-parser.js','nesting-engine.js','drawing-layout.js'):
        page=page.replace(f'<script src="./{name}"></script>', '<script>'+ (ROOT/name).read_text()+'</script>')
    return page

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':467,'height':780})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.set_content(source_html(),wait_until='domcontentloaded')
    await page.evaluate("rows=[{rowId:'1KB',length:700,width:100,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'2KB',length:700,width:100,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'3KB',length:720,width:100,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}];renderRows()")
    # No part dropdown: navigation is strictly sequential.
    assert await page.locator('#bandingPart').count()==0
    await page.locator('#openBanding').click()
    await page.wait_for_function("document.querySelector('#bandingDialog').open")
    await page.screenshot(path=str(ROOT/'verification'/'guided-banding-dialog.png'), full_page=True)
    assert await page.locator('#bandingProgress').inner_text()=='Part 1 of 3'
    assert await page.locator('#bandingCurrentRef').inner_text()=='1KB'
    assert '700 × 100 mm' in await page.locator('#bandingCurrentDims').inner_text()
    # First row: save while typing; Next advances to the second reference.
    for ident,val in [('band08Length','2'),('band08Width','1'),('band2Length','0'),('band2Width','0')]:
      await page.locator('#'+ident).fill(val)
    await page.locator('#bandingNext').click()
    await page.wait_for_function("document.querySelector('#bandingProgress').textContent==='Part 2 of 3'")
    a=await page.evaluate('rows[0].edgeBandingSpec')
    assert a=={'0.8':{'length':2,'width':1},'2':{'length':0,'width':0}},a
    assert await page.locator('#bandingCurrentRef').inner_text()=='2KB'
    assert await page.locator('#band08Length').input_value()=='0'
    # Second row: set a different material mapping, then move forward.
    for ident,val in [('band08Length','0'),('band08Width','0'),('band2Length','1'),('band2Width','2')]:
      await page.locator('#'+ident).fill(val)
    await page.locator('#bandingNext').click()
    await page.wait_for_function("document.querySelector('#bandingProgress').textContent==='Part 3 of 3'")
    b=await page.evaluate('rows[1].edgeBandingSpec')
    assert b=={'0.8':{'length':0,'width':0},'2':{'length':1,'width':2}},b
    assert await page.locator('#bandingNext').inner_text()=='Finish ✓'
    # Previous rehydrates the second row's saved values.
    await page.locator('#bandingPrev').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='2KB'
    assert await page.locator('#band2Length').input_value()=='1'
    await page.locator('#bandingNext').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='3KB'
    # Invalid count must block navigation and keep the current part active.
    await page.locator('#band08Length').fill('3')
    await page.locator('#bandingNext').click()
    assert await page.locator('#bandingProgress').inner_text()=='Part 3 of 3'
    # Correct it, Finish should close cleanly.
    await page.locator('#band08Length').fill('0')
    await page.locator('#bandingNext').click()
    await page.wait_for_function("!document.querySelector('#bandingDialog').open")
    # Material totals use each row's dimensions and quantity.
    totals=await page.evaluate('calculateBandingTotals()')
    assert totals['0.8']==(700*2+100*1)*2,totals
    assert totals['2']==(700*1+100*2)*2,totals
    # Reopen at first row, then Escape closes; all row-specific values remain.
    await page.locator('#openBanding').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='3KB' # keeps last edited position
    await page.keyboard.press('Escape')
    await page.wait_for_function("!document.querySelector('#bandingDialog').open")
    assert not errors,errors
    await page.screenshot(path=str(ROOT/'verification'/'guided-banding-mobile.png'), full_page=True)
    widths=await page.evaluate("({viewport:innerWidth,doc:document.documentElement.scrollWidth,table:document.querySelector('.table-wrap').scrollWidth,tableClient:document.querySelector('.table-wrap').clientWidth})")
    assert widths['doc']<=widths['viewport'] and widths['table']<=widths['tableClient']+1,widths
    print('PASS: one-reference workflow; automatic per-row save; Next/Previous rehydration; invalid input blocked; Finish closes; edge totals correct; Escape closes; no narrow viewport overflow:',widths)
    await browser.close()
asyncio.run(main())
