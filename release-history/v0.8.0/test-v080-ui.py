import asyncio, re, json
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parent

def source_html():
    page=(ROOT/'index.html').read_text()
    page=re.sub(r'<script src="https://[^\"]+"></script>\s*','',page)
    for name in ('cutting-list-parser.js','nesting-engine.js','drawing-layout.js'):
        page=page.replace(f'<script src="./{name}"></script>', '<script>'+ (ROOT/name).read_text()+'</script>')
    return page

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    page=await browser.new_page(viewport={'width':1365,'height':900})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    await page.set_content(source_html(),wait_until='domcontentloaded')
    await page.evaluate("""rows=[
      {rowId:'A1',length:1200,width:470,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},
      {rowId:'B2',length:700,width:300,qty:1,rotate:false,edgeBandingSpec:{'0.8':{length:0,width:0},'2':{length:1,width:2}}},
      {rowId:'C3',length:180,width:90,qty:4,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}
    ]; renderRows();""")
    # Verify the unified row editor exposes all requested fields.
    await page.locator('#openBanding').click()
    (ROOT/'verification').mkdir(exist_ok=True)
    await page.locator('#bandingDialog').screenshot(path=str(ROOT/'verification'/'v0.8.0-row-editor.png'))
    for field in ['#editRowRef','#editRowLength','#editRowWidth','#editRowQty','#editRowRotate','#band08Length','#band08Width','#band2Length','#band2Width']:
      assert await page.locator(field).count()==1,field
    await page.locator('#editRowRef').fill('A1-REV')
    await page.locator('#editRowLength').fill('1200.0')
    await page.locator('#bandingNext').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='A1-REV'
    assert await page.evaluate('rows[0].length')==1200
    await page.locator('#editRowLength').fill('720')
    await page.locator('#editRowWidth').fill('310')
    await page.locator('#editRowQty').fill('5')
    await page.locator('#editRowRotate').check()
    await page.locator('#band08Length').fill('2')
    await page.locator('#band08Width').fill('1')
    await page.locator('#band2Length').fill('0')
    await page.locator('#band2Width').fill('2')
    current=await page.evaluate("rows[0]")
    assert current['rowId']=='A1-REV' and current['length']==720 and current['width']==310 and current['qty']==5 and current['rotate'] is True,current
    assert current['edgeBandingSpec']['0.8']=={'length':2,'width':1},current
    assert current['edgeBandingSpec']['2']=={'length':0,'width':2},current
    await page.set_viewport_size({'width':467,'height':850})
    mobile=await page.evaluate('({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})')
    assert mobile['scroll']<=mobile['client']+1,mobile
    await page.set_viewport_size({'width':1365,'height':900})
    await page.locator('#bandingNext').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='B2'
    await page.locator('#bandingPrev').click()
    assert await page.locator('#bandingCurrentRef').inner_text()=='A1-REV'
    table=await page.evaluate('''({ref:document.querySelector('#partsBody tr:nth-child(1) input[data-k=rowId]')?.value,length:document.querySelector('#partsBody tr:nth-child(1) input[data-k=length]')?.value,width:document.querySelector('#partsBody tr:nth-child(1) input[data-k=width]')?.value,qty:document.querySelector('#partsBody tr:nth-child(1) input[data-k=qty]')?.value})''')
    assert table=={'ref':'A1-REV','length':'720','width':'310','qty':'5'},table
    await page.locator('#bandingNext').click()
    await page.locator('#bandingNext').click()
    await page.locator('#bandingNext').click()
    assert await page.locator('#bandingDialog').get_attribute('open') is None

    # Table editor also refuses fractional dimensions.
    await page.locator('#partsBody tr:nth-child(1) input[data-k="length"]').fill('720.5')
    await page.locator('#partsBody tr:nth-child(1) input[data-k="length"]').press('Tab')
    assert await page.evaluate('rows[0].length')==720

    # Parser rules: integer dimensions only; auto-import quantity <= 10; suspicious values go to review.
    parsed=await page.evaluate("""CutPlanParser.parseOcrRows('OK1 600__ x 400_ 2\\nHIGH1 700 x 450 11\\nDEC1 700.5 x 400 2\\nDEC2 700 x 400.25 2\\nDEC3 700.0 x 400 2')""")
    assert len(parsed['rows'])==1,parsed
    assert len(parsed['rejected'])==4,parsed
    assert any('greater than 10' in x['reason'] for x in parsed['rejected']),parsed
    assert sum('whole-number' in x['reason'] for x in parsed['rejected'])==3,parsed
    await page.evaluate("unresolvedRows=CutPlanParser.parseOcrRows('HIGH1 700 x 450 11\\nDEC1 700.5 x 400 2').rejected; renderUnresolvedRows();")
    assert await page.locator('.unresolved-card').count()==2
    assert 'whole-number millimetres' in await page.locator('.unresolved-card').nth(1).inner_text()
    # Explicit review confirmation may accept quantity 11; decimal dimensions must be corrected first.
    await page.locator('.unresolved-card').nth(0).locator('[data-resolve]').click()
    assert await page.evaluate("rows[rows.length-1].qty")==11
    await page.locator('.unresolved-card').nth(0).locator('[data-u-k=length]').fill('700')
    await page.locator('.unresolved-card').nth(0).locator('[data-resolve]').click()
    assert await page.evaluate("rows[rows.length-1].length")==700

    # Simulate 12 digital PDF pages with 8 rows on each: every page must be visited and all rows found.
    await page.evaluate("""window.pdfjsLib={GlobalWorkerOptions:{},getDocument:({data})=>({promise:Promise.resolve({numPages:12,getPage:async n=>({getTextContent:async()=>({items:Array.from({length:8},(_,r)=>{const id=(n-1)*8+r+1,y=700-r*18;return [
      {str:'P'+String(id).padStart(3,'0'),transform:[10,0,0,10,10,y],width:24},
      {str:String(500+id),transform:[10,0,0,10,50,y],width:20},
      {str:String(300+id),transform:[10,0,0,10,90,y],width:20},
      {str:'2',transform:[10,0,0,10,130,y],width:4}
    ]}).flat()}),cleanup:()=>{}})})})};""")
    pdf_result=await page.evaluate("""async()=>{const f=new File([new Uint8Array([1,2,3])],'big-schedule.pdf',{type:'application/pdf'});return await readPdf(f)}""")
    extracted=await page.evaluate('text => parseOcrRows(text)',pdf_result['text'])
    assert pdf_result['pages']==12 and len(extracted['rows'])==96,(pdf_result.get('method'),len(extracted['rows']))

    # A scanned or poorly extracted PDF triggers OCR across every page.
    await page.evaluate("""window.pdfjsLib={GlobalWorkerOptions:{},getDocument:({data})=>({promise:Promise.resolve({numPages:2,getPage:async n=>({getTextContent:async()=>({items:[{str:'unreadable page content',transform:[10,0,0,10,10,700],width:100}]}),getViewport:()=>({width:200,height:200}),render:async()=>({promise:Promise.resolve()}),cleanup:()=>{}})})})};
      window.Tesseract={createWorker:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'OCR1 600 x 400 2\\nOCR2 700 x 300 1'}}),terminate:async()=>{}})};""")
    ocr_result=await page.evaluate("""async()=>{const f=new File([new Uint8Array([1])],'scanned.pdf',{type:'application/pdf'});return await readPdf(f)}""")
    assert ocr_result['method'].startswith('Full-document OCR') and 'OCR2' in ocr_result['text'],ocr_result

    # Board heading should now be name-only, centred and bold.
    board=await page.evaluate("""()=>{
      const plan=CutPlanEngine.optimize([
        {rowId:'PANEL-A',length:1800,width:580,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},
        {rowId:'DRAWER-SMALL',length:95,width:42,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},
        {rowId:'PANEL-B',length:900,width:480,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}
      ],{sheetLength:2420,sheetWidth:1200,kerf:3,effort:'quick',seed:77});
      plan.kerfKnown=true;lastPlan=plan;renderPlan(plan);
      const title=document.querySelector('.sheet-title');
      return {name:document.querySelector('.sheet-name-print')?.textContent,heading:title?.innerText,
        smallCount:title?.querySelectorAll('small').length,align:getComputedStyle(title).textAlign,
        weight:getComputedStyle(document.querySelector('.sheet-name-print')).fontWeight};
    }""")
    assert board['name'] and 'BOARD' not in board['heading'] and 'mm' not in board['heading'] and board['smallCount']==0,board
    assert board['align']=='center' and int(board['weight'])>=700,board
    await page.locator('.sheet-card').first.screenshot(path=str(ROOT/'verification'/'v0.8.0-board-preview.png'))
    await page.emulate_media(media='print')
    await page.pdf(path=str(ROOT/'verification'/'v0.8.0-print-check.pdf'),format='A4',print_background=True,prefer_css_page_size=True)
    assert not errors,errors
    print('CutPlan v0.8.0 UI checks passed: full-row editor, auto-save, Previous/Next, integer-only edits, review queue, 12-page PDF text extraction (96 rows), OCR fallback for low-quality PDF text, name-only board heading.')
    await browser.close()

if __name__=='__main__': asyncio.run(main())
