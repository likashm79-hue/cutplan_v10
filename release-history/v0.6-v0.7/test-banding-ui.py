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
        page=await browser.new_page(viewport={"width":467,"height":455})
        errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
        await page.set_content(source_html(),wait_until='domcontentloaded')
        await page.evaluate("rows=[{rowId:'A1',length:1200,width:470,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'B2',length:700,width:300,qty:1,rotate:false,edgeBandingSpec:emptyEdgeBandingSpec()}];renderRows()")
        layout=await page.evaluate("({wrapWidth:document.querySelector('.table-wrap').clientWidth,wrapScroll:document.querySelector('.table-wrap').scrollWidth,tableWidth:document.querySelector('.parts-table').getBoundingClientRect().width,headers:[...document.querySelectorAll('.parts-table th')].map(x=>x.textContent.trim()),bandingColumn:!![...document.querySelectorAll('.parts-table th')].find(x=>/band/i.test(x.textContent)),bandingPanel:!!document.querySelector('#bandingTitle')})")
        assert layout['wrapScroll'] <= layout['wrapWidth']+1, layout
        page_width=await page.evaluate('({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})')
        assert page_width['scroll'] <= page_width['client']+1, page_width
        assert len(layout['headers'])==6 and not layout['bandingColumn'] and layout['bandingPanel'],layout
        assert await page.locator('#bandingPart option').count()==2
        await page.locator('#bandingPart').select_option('1')
        for ident,value in [('band08Length','2'),('band08Width','1'),('band2Length','1')]:
            await page.locator('#'+ident).fill(value); await page.locator('#'+ident).dispatch_event('change')
        result=await page.evaluate("({spec:rows[1].edgeBandingSpec,summary:document.getElementById('bandingSummary').textContent,totals:document.getElementById('mBand08').textContent,tableInputs:document.querySelectorAll('#partsBody input[data-k^=\\\"band\\\"]').length})")
        assert result['spec']['0.8']=={'length':2,'width':1} and result['spec']['2']['length']==1
        assert 'B2' in result['summary'] and result['tableInputs']==0 and not errors
        await page.locator('#goBanding').click()
        assert await page.evaluate("document.activeElement.id") == 'bandingPart'
        # Exercise native Fullscreen when supported, then force the CSS fallback.
        native_fullscreen = await page.evaluate('!!(document.fullscreenEnabled && document.getElementById("inputPanel").requestFullscreen)')
        if native_fullscreen:
            await page.locator('#fullscreenWorkspace').click()
            await page.wait_for_function('!!document.fullscreenElement', timeout=3000)
            await page.evaluate('document.exitFullscreen()')
            await page.wait_for_function('!document.fullscreenElement', timeout=3000)
        await page.evaluate("document.getElementById('inputPanel').requestFullscreen=undefined")
        await page.locator('#fullscreenWorkspace').click()
        assert await page.locator('#inputPanel').evaluate("el=>el.classList.contains('expanded-workspace')")
        await page.locator('#fullscreenWorkspace').click()
        assert not await page.locator('#inputPanel').evaluate("el=>el.classList.contains('expanded-workspace')")
        # Render a real guillotine plan; every free leaf must get a numbered visual and schedule entry.
        await page.evaluate("$('sheetL').value='1200';$('sheetW').value='800';$('kerf').value='3';const plan=CutPlanEngine.optimize([{rowId:'P1',length:500,width:300,qty:1,rotate:true}],{sheetLength:1200,sheetWidth:800,kerf:3,effort:'quick',seed:7});plan.kerfKnown=true;lastPlan=plan;renderPlan(plan)")
        offcuts=await page.evaluate("({listed:document.querySelectorAll('.offcut-item').length,overlays:document.querySelectorAll('.offcut-highlight rect').length,summary:document.getElementById('offcutSummary').innerText,reported:document.querySelector('.offcut-report')?.innerText||''})")
        assert offcuts['listed']==offcuts['overlays'] and 'leftover boxes counted' in offcuts['summary']
        assert 'Reusable offcut' in offcuts['reported'] or 'Small scrap' in offcuts['reported']
        assert not errors,errors
        print('Responsive cutting-list / separate banding / native-fullscreen:',native_fullscreen,'fallback / numbered-offcut UI passed:',layout,page_width,result,offcuts)
        await browser.close()
if __name__=='__main__': asyncio.run(main())
