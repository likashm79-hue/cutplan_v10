import asyncio, re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent

def source_html():
    page = (ROOT / 'index.html').read_text()
    page = re.sub(r'<script src="https://[^\"]+"></script>\s*', '', page)
    for name in ('cutting-list-parser.js', 'nesting-engine.js', 'drawing-layout.js'):
        page = page.replace(f'<script src="./{name}"></script>', '<script>' + (ROOT / name).read_text() + '</script>')
    return page

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1365, 'height': 900})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.set_content(source_html(), wait_until='domcontentloaded')
        (ROOT / 'verification').mkdir(exist_ok=True)

        # Review queue is completely absent, and every detected candidate lands in the main rows table.
        assert await page.locator('#unresolvedWrap').count() == 0
        assert 'Items needing review' not in await page.locator('body').inner_text()
        await page.locator('#ocrText').fill('''Cutting List
Reference | Length | Width | Qty
A1 600__ x 400_ = 2
A1 700.5 x 300.25 = 11
B2 500 x 250 = 3
Page 1 of 1
Grand Total 16
BROKEN 780 -- 2''')
        await page.locator('#parseOcr').click()
        assert await page.locator('#partsBody tr').count() == 3
        summary = await page.locator('#rowSummary').inner_text()
        assert '3 rows' in summary, summary
        table_refs = await page.locator('#partsBody input[data-k="rowId"]').evaluate_all('(els)=>els.map(e=>e.value)')
        assert table_refs == ['A1', 'A1-2', 'B2'], table_refs
        table_dims = await page.locator('#partsBody tr').nth(1).locator('input[data-k="length"], input[data-k="width"], input[data-k="qty"]').evaluate_all('(els)=>els.map(e=>e.value)')
        assert table_dims == ['701', '300', '11'], table_dims
        assert await page.locator('#bandingSourceInfo').count() == 1
        await page.screenshot(path=str(ROOT/'verification'/'v1.0.0-imported-main-list.png'), full_page=True)

        # The notes and source line are accessible from the same row editor; no separate queue is involved.
        await page.locator('#openBanding').click()
        await page.locator('#bandingDialog').screenshot(path=str(ROOT/'verification'/'v1.0.0-row-editor.png'))
        assert await page.locator('#bandingCurrentRef').inner_text() == 'A1'
        await page.locator('#bandingNext').click()
        assert await page.locator('#bandingCurrentRef').inner_text() == 'A1-2'
        source_note = await page.locator('#bandingSourceInfo').inner_text()
        assert '700.5' in source_note and 'normalized' in source_note.lower(), source_note
        # All row fields remain editable, saved and navigable.
        await page.locator('#editRowLength').fill('702')
        await page.locator('#editRowWidth').fill('301')
        await page.locator('#editRowQty').fill('12')
        await page.locator('#bandingNext').click()
        assert await page.evaluate("rows[1].length") == 702
        assert await page.evaluate("rows[1].width") == 301
        assert await page.evaluate("rows[1].qty") == 12
        assert await page.locator('#bandingCurrentRef').inner_text() == 'B2'
        await page.locator('#bandingPrev').click()
        assert await page.locator('#bandingCurrentRef').inner_text() == 'A1-2'
        await page.locator('#closeBanding').click()
        updated = await page.locator('#partsBody tr').nth(1).locator('input[data-k="length"]').input_value()
        assert updated == '702'

        # 12-page PDF digital text extraction: all pages are visited and 96 rows remain ordered.
        await page.evaluate("""window.pdfjsLib={GlobalWorkerOptions:{},getDocument:({data})=>({promise:Promise.resolve({numPages:12,getPage:async n=>({getTextContent:async()=>({items:Array.from({length:8},(_,r)=>{const id=(n-1)*8+r+1,y=700-r*18;return [
          {str:'P'+String(id).padStart(3,'0'),transform:[10,0,0,10,10,y],width:24},
          {str:String(500+id),transform:[10,0,0,10,60,y],width:20},
          {str:String(300+id),transform:[10,0,0,10,110,y],width:20},
          {str:'2',transform:[10,0,0,10,160,y],width:4}
        ]}).flat()}),cleanup:()=>{}})})})};""")
        pdf_result = await page.evaluate("""async()=>{const file=new File([new Uint8Array([1,2,3])],'long-schedule.pdf',{type:'application/pdf'});return await readPdf(file)}""")
        extracted = await page.evaluate('(text)=>parseOcrRows(text)', pdf_result['text'])
        assert pdf_result['pages'] == 12 and len(extracted['rows']) == 96, (pdf_result, len(extracted['rows']))
        assert extracted['rows'][0]['rowId'] == 'P001' and extracted['rows'][-1]['rowId'] == 'P096'

        # A weak single page receives two OCR segmentation passes and is selectively replaced.
        await page.evaluate("""window.pdfjsLib={GlobalWorkerOptions:{},getDocument:({data})=>({promise:Promise.resolve({numPages:2,getPage:async n=>({getTextContent:async()=>({items:n===1?Array.from({length:3},(_,r)=>{const id=r+1,y=700-r*20;return [
          {str:'D'+id,transform:[10,0,0,10,10,y],width:18},{str:'600',transform:[10,0,0,10,60,y],width:18},{str:'400',transform:[10,0,0,10,110,y],width:18},{str:'2',transform:[10,0,0,10,160,y],width:4}
        ]}).flat():[{str:'image only',transform:[10,0,0,10,10,700],width:30}]}),getViewport:()=>({width:200,height:200}),render:()=>({promise:Promise.resolve()}),cleanup:()=>{}})})})};
        window.Tesseract={createWorker:async()=>({setParameters:async(p)=>{window.__psm=p.tessedit_pageseg_mode;},recognize:async()=>({data:{text:window.__psm===6?'OCRP2A 700 x 300 = 2':'OCRP2A 700 x 300 = 2\\nOCRP2B 650 x 250 = 1',confidence:88}}),terminate:async()=>{}})};""")
        weak_pdf = await page.evaluate("""async()=>{const file=new File([new Uint8Array([1])],'weak.pdf',{type:'application/pdf'});return await readPdf(file)}""")
        assert weak_pdf['checkedPages'] == [2], weak_pdf
        assert weak_pdf['ocrPages'] == [2], weak_pdf
        weak_rows = await page.evaluate('(text)=>parseOcrRows(text).rows.map(r=>r.rowId)', weak_pdf['text'])
        assert 'OCRP2B' in weak_rows, weak_rows

        # Existing drawing and A4 print behavior still work.
        await page.evaluate("""rows=[{rowId:'PANEL-A',length:1800,width:580,qty:1,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()},{rowId:'DRAWER-SMALL',length:95,width:42,qty:2,rotate:true,edgeBandingSpec:emptyEdgeBandingSpec()}];renderRows();""")
        await page.locator('#sheetL').fill('2440')
        await page.locator('#sheetW').fill('1220')
        await page.locator('[data-cut-mode="optimum"]').click()
        await page.locator('#printBtn').wait_for(state='visible')
        await page.locator('.sheet-card').first.screenshot(path=str(ROOT/'verification'/'v1.0.0-board-preview.png'))
        await page.emulate_media(media='print')
        await page.pdf(path=str(ROOT/'verification'/'v1.0.0-print-check.pdf'), format='A4', print_background=True, prefer_css_page_size=True)
        assert not errors, errors
        print('CutPlan v1.0.0 UI tests passed: no review queue; all parsed rows on main table; duplicates/decimals/high quantity preserved; source notes in row editor; 12-page extraction; selective dual-PSM OCR; optimization and PDF rendering.')
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
