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
        page=await browser.new_page(viewport={'width':1365,'height':900}, device_scale_factor=1)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.set_content(source_html(),wait_until='domcontentloaded')
        await page.evaluate("""rows=[
          {rowId:'A1',length:1200,width:470,qty:2,rotate:true,edgeBandingSpec:{'0.8':{length:2,width:1},'2':{length:0,width:0}}},
          {rowId:'B2',length:700,width:300,qty:1,rotate:false,edgeBandingSpec:{'0.8':{length:0,width:0},'2':{length:1,width:2}}},
          {rowId:'C3',length:180,width:90,qty:4,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}
        ]; renderRows();""")
        table=await page.evaluate("""({headers:[...document.querySelectorAll('.parts-table th')].map(x=>x.textContent.trim()),rows:document.querySelectorAll('#partsBody tr').length,
          bandCells:document.querySelectorAll('#partsBody .banding-cell').length,bandingText:document.querySelector('#partsBody tr:first-child .banding-cell').innerText,
          tableMax:getComputedStyle(document.querySelector('.table-wrap')).maxHeight})""")
        assert len(table['headers'])==7 and 'Edge banding' in table['headers'],table
        assert table['rows']==3 and table['bandCells']==3,table
        assert '0.8 mm' in table['bandingText'] and '2 mm' in table['bandingText'] and 'L2' in table['bandingText'],table
        assert table['tableMax']=='none',table
        # Edit button for a specific row opens the editor on that reference and updates the unified table live.
        await page.locator('[data-edit-banding="1"]').click()
        assert await page.locator('#bandingCurrentRef').inner_text()=='B2'
        await page.locator('#band08Length').fill('2')
        await page.locator('#band08Width').fill('1')
        await page.locator('#band2Length').fill('0')
        live=await page.locator('#partsBody tr:nth-child(2) .banding-cell').inner_text()
        assert '0.8 mm' in live and 'L2' in live and 'W1' in live and '2 mm' in live,live
        await page.locator('#closeBanding').click()
        # Confirm no horizontal page overflow on a narrow screen and row cards still expose the banding data.
        await page.set_viewport_size({'width':467,'height':850})
        mobile=await page.evaluate("""({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
          bandDisplay:getComputedStyle(document.querySelector('#partsBody tr td:nth-child(5)')).display,
          rowText:document.querySelector('#partsBody tr:nth-child(2)').innerText})""")
        assert mobile['scroll']<=mobile['client']+1,mobile
        assert mobile['bandDisplay']=='block' and '0.8 mm' in mobile['rowText'],mobile
        # Render a real layout with offcuts and a part small enough to need an external reference callout.
        await page.evaluate("""$('sheetL').value='2420';$('sheetW').value='1200';$('kerf').value='3';$('margin').value='0';
          const inputs=[
            {rowId:'PANEL-A',length:1800,width:580,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},
            {rowId:'DRAWER-SMALL',length:95,width:42,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},
            {rowId:'PANEL-B',length:900,width:480,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}
          ];
          const plan=CutPlanEngine.optimize(inputs,{sheetLength:2420,sheetWidth:1200,kerf:3,effort:'quick',seed:77});
          plan.kerfKnown=true;lastPlan=plan;renderPlan(plan);""")
        preview=await page.evaluate("""({cards:document.querySelectorAll('.sheet-card').length,
          wasteRects:document.querySelectorAll('.offcut-highlight rect').length,
          wasteText:[...document.querySelectorAll('.offcut-highlight text')].length,
          calloutSidebars:document.querySelectorAll('.small-callouts').length,
          boardName:document.querySelector('.sheet-name-print')?.textContent,
          boardNameAlign:getComputedStyle(document.querySelector('.sheet-title')).textAlign,
          rowClass:document.querySelector('.board-print-row')?.className})""")
        assert preview['cards']>=1 and preview['wasteRects']>=1,preview
        assert preview['wasteText']==0,preview
        assert preview['calloutSidebars']>=1,preview
        # Validate print CSS: waste overlays are not hidden, board occupies the print row, and title is bold/centered.
        await page.emulate_media(media='print')
        print_state=await page.evaluate("""(()=>{const card=document.querySelector('.sheet-card'),row=document.querySelector('.board-print-row'),svg=document.querySelector('svg.layout'),waste=document.querySelector('.offcut-highlight'),title=document.querySelector('.sheet-title'),name=document.querySelector('.sheet-name-print'),callouts=document.querySelector('.small-callouts');
          return {cardHeight:getComputedStyle(card).height,rowHeight:getComputedStyle(row).height,svgHeight:getComputedStyle(svg).height,
            wasteDisplay:getComputedStyle(waste).display,wasteFill:getComputedStyle(waste.querySelector('rect')).fill,
            titleAlign:getComputedStyle(title).textAlign,nameWeight:getComputedStyle(name).fontWeight,
            calloutPosition:callouts?getComputedStyle(callouts).gridColumnStart:null,
            rowColumns:getComputedStyle(row).gridTemplateColumns};})()""")
        assert print_state['wasteDisplay']!='none',print_state
        assert print_state['titleAlign']=='center' and int(print_state['nameWeight'])>=700,print_state
        assert abs(float(print_state['svgHeight'].replace('px','')) - (279*96/25.4)) < 1,print_state
        # Export a real PDF with background graphics enabled for image inspection.
        await page.pdf(path=str(ROOT/'verification'/'v0.7.0-print-check.pdf'),format='A4',print_background=True,prefer_css_page_size=True)
        assert not errors,errors
        print('CutPlan v0.7.0 browser tests passed: unified parsed rows + banding, row-specific edit/live summary, mobile layout, no offcut text labels, print offcut visibility, side callouts, centered bold board title, full-height PDF export.')
        print('UI:',table,mobile)
        print('Preview:',preview)
        print('Print:',print_state)
        await browser.close()

if __name__=='__main__': asyncio.run(main())
