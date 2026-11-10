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
        page=await browser.new_page(viewport={'width':542,'height':700})
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.set_content(source_html(),wait_until='domcontentloaded')
        await page.evaluate("rows=[{rowId:'1KB',length:700,width:100,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'2KB',length:700,width:100,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'3KB',length:720,width:100,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}];renderRows()")
        # The screenshot defect must be impossible in the current markup.
        table=await page.evaluate("({heads:[...document.querySelectorAll('.parts-table thead th')].map(x=>x.textContent.trim()),scroll:document.querySelector('.table-wrap').scrollWidth,client:document.querySelector('.table-wrap').clientWidth,button:!!document.querySelector('#openBanding'),launch:!!document.querySelector('.banding-launch-card')})")
        assert table['heads'] == ['Ref','Length','Width','Qty','Rot.',''], table
        assert table['scroll'] <= table['client']+1, table
        assert table['button'] and table['launch'], table
        # Open modal, select part, save counts, switch parts, reopen and verify persistence.
        await page.locator('#openBanding').click()
        await page.wait_for_function("document.querySelector('#bandingDialog').open")
        assert await page.locator('#bandingPart').is_visible()
        await page.locator('#bandingPart').select_option('0')
        for ident,val in [('band08Length','2'),('band08Width','1'),('band2Length','1'),('band2Width','2')]:
            await page.locator('#'+ident).fill(val)
        # Moving focus away from the last numeric input triggers its normal change/save event.
        await page.locator('#bandingPart').focus()
        spec1=await page.evaluate("rows[0].edgeBandingSpec")
        assert spec1['0.8']=={'length':2,'width':1} and spec1['2']=={'length':1,'width':2},spec1
        await page.locator('#bandingPart').select_option('1')
        # Part 2 begins independently at zero; part 1 must remain saved.
        spec2=await page.evaluate("({a:rows[0].edgeBandingSpec,b:rows[1].edgeBandingSpec})")
        assert spec2['a']==spec1 and spec2['b']['0.8']=={'length':0,'width':0},spec2
        await page.locator('#closeBanding').click()
        await page.wait_for_function("!document.querySelector('#bandingDialog').open")
        await page.locator('#openBanding').click()
        await page.wait_for_function("document.querySelector('#bandingDialog').open")
        await page.locator('#bandingPart').select_option('0')
        values=await page.evaluate("['band08Length','band08Width','band2Length','band2Width'].map(id=>document.getElementById(id).value)")
        assert values==['2','1','1','2'],values
        # Escape closes the native modal.
        await page.keyboard.press('Escape')
        await page.wait_for_function("!document.querySelector('#bandingDialog').open")
        # Validate both narrow screenshot widths and full-width launch button.
        await page.locator('#openBanding').click()
        box=await page.locator('#openBanding').bounding_box()
        assert box and box['width'] >= 250, box
        await page.keyboard.press('Escape')
        await page.wait_for_function("!document.querySelector('#bandingDialog').open")
        await page.set_viewport_size({'width':467,'height':700})
        narrow=await page.evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth,table:document.querySelector('.table-wrap').scrollWidth,tableClient:document.querySelector('.table-wrap').clientWidth})")
        assert narrow['document'] <= narrow['viewport'] and narrow['table'] <= narrow['tableClient']+1, narrow
        await page.locator('#openBanding').click()
        dialog_width=await page.locator('#bandingDialog').evaluate('el=>el.getBoundingClientRect().width')
        assert dialog_width <= 467, dialog_width
        assert not errors,errors
        print('PASS: no edge-banding table column; no horizontal scroll at 542px and 467px; full-width workspace button; dialog opens; per-part values save independently; values persist when switching/reopening; Close and Escape work; mobile CTA width:',round(box['width']),'467px layout:',narrow)
        await browser.close()
asyncio.run(main())
