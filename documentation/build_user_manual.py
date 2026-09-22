"""Build the customer guide: one landscape A4 sheet with two portrait A5 panels.

Requires reportlab. Use --font-dir for a directory with Arial TTF fonts.
The PDF in docs/ is also copied to the web installer's public downloads.
"""
from pathlib import Path
import argparse
import shutil
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT = Path(__file__).resolve().parents[1]
SITE = 'https://alarmmini.vercel.app'
SUPPORT = 'https://t.me/+j3zFZHE5gGoyNGYy'
NAVY = HexColor('#122C46')
BLUE = HexColor('#175B99')
GRAY = HexColor('#526270')
PALE = HexColor('#F0F4F7')

COPY = {
 'UA': {
  'title': 'Ваша мапа. Ваш ритм.',
  'subtitle': 'Короткий посібник • Українська',
  'intro': 'Стан тривог на LED-мапі України. Керування з телефона, оновлення через USB.',
  'sections': [
   ('01', 'Підключіть до Wi-Fi', 'Увімкніть мапу. На телефоні підключіться до <b>AlarmMap-Setup-XXXXXX</b> без пароля. Відкрийте <b>http://192.168.4.1</b>, оберіть домашню мережу <b>2,4 ГГц</b> і збережіть її пароль. Поверніться до домашнього Wi-Fi.'),
   ('02', 'Відкрийте панель', 'Відскануйте QR або відкрийте адресу з етикетки мапи. Введіть пароль адміністратора з етикетки. Адресу й пароль також можна переглянути на сайті інсталятора, підключивши плату через USB.'),
   ('03', 'Оберіть мову та місцевий час', '<b>UA / EN</b> перемикає мову. У <b>Нічний режим → Часовий пояс</b> знайдіть країну/місто або натисніть <b>Визначити з браузера</b>. Для подарунка оберіть місце одержувача. Літній/зимовий час змінюється автоматично. Натисніть <b>Зберегти</b>.'),
   ('04', 'Налаштуйте під себе', '<b>Кольори</b>: денна/нічна яскравість і кольори станів. <b>Нічний режим</b>: час початку та завершення. <b>MQTT</b>: основний і резервний канали. Початковий профіль уже налаштований. Перед змінами зробіть <b>Експорт</b> JSON; для повернення використайте <b>Імпорт</b>.'),
   ('05', 'Оновлюйте зі збереженням', 'На комп’ютері відкрийте сайт нижче в <b>Chrome або Edge</b>. Підключіть плату USB-кабелем із даними, виберіть модель та оновлення зі збереженням налаштувань. Не від’єднуйте USB до завершення. Після цього оновіть сторінку мапи.'),
  ],
  'help': 'Не відкривається панель? Перевірте, що телефон і мапа в одній Wi-Fi мережі; спробуйте IP-адресу з інсталятора. Немає актуальних даних? Перевірте Wi-Fi / MQTT та інтернет.',
  'note': 'Мапа є допоміжним індикатором. Орієнтуйтеся на офіційні сповіщення про небезпеку.',
  'qr': 'Сайт та оновлення',
  'support': 'Допомога в Telegram',
  'footer': 'v2.1.5 • Особисте використання дозволене. Комерційне - за згодою автора.',
 },
 'EN': {
  'title': 'Your map. Your rhythm.',
  'subtitle': 'Quick user guide • English',
  'intro': 'Ukraine alerts on your LED map. Phone controls, USB updates.',
  'sections': [
   ('01', 'Connect to Wi-Fi', 'Power on the map. On your phone, join <b>AlarmMap-Setup-XXXXXX</b> without a password. Open <b>http://192.168.4.1</b>, choose your home <b>2.4 GHz</b> network and save its password. Rejoin your home Wi-Fi.'),
   ('02', 'Open the dashboard', 'Scan the QR code or open the address on the map’s label. Enter the admin password from the label. You can also view the address and password on the installer website with the board connected by USB.'),
   ('03', 'Choose language and local time', '<b>UA / EN</b> changes the language. Under <b>Night mode → Time zone</b>, search for a country/city or select <b>Use browser time zone</b>. For a gift, choose the recipient’s location. Summer/winter time changes automatically. Select <b>Save</b>.'),
   ('04', 'Make it yours', '<b>Colors</b>: day/night brightness and state colors. <b>Night mode</b>: start and end times. <b>MQTT</b>: primary and fallback sources. The initial profile is already configured. Before editing, use <b>Export</b> to save a JSON backup; use <b>Import</b> to restore it.'),
   ('05', 'Update and keep your settings', 'On a computer, open the website below in <b>Chrome or Edge</b>. Connect the board with a USB data cable, choose the board model and update while preserving settings. Keep USB connected until the update finishes. Then refresh the map’s page.'),
  ],
  'help': 'Dashboard unavailable? Connect the phone and map to the same Wi-Fi; try the IP address shown by the installer. Stale data? Check Wi-Fi / MQTT status and the internet connection.',
  'note': 'The map is a supplementary display. Always follow official emergency notifications.',
  'qr': 'Website & updates',
  'support': 'Telegram support',
  'footer': 'v2.1.5 • Personal use permitted. Commercial use requires author permission.',
 }
}

def build(font_dir):
    for name, file in [('Arial', 'arial.ttf'), ('Arial-Bold', 'arialbd.ttf')]:
        pdfmetrics.registerFont(TTFont(name, str(font_dir / file)))
    pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold')
    output = ROOT / 'docs/AlarmMini_User_Manual_UA_EN.pdf'
    output.parent.mkdir(exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=landscape(A4), pageCompression=1)
    c.setTitle('AlarmMini | User guide UA + EN | A4 / 2 x A5')
    c.setAuthor('WebDev-Den')
    width, height = landscape(A4)
    half = width / 2
    c.setStrokeColor(HexColor('#BDC7CF'))
    c.setDash(3, 4)
    c.line(half, 12, half, height-12)
    c.setDash()

    def paragraph(text, x, y, w, size=9.1, color=NAVY, leading=12.5):
        style = ParagraphStyle('body', fontName='Arial', fontSize=size, leading=leading, textColor=color)
        p = Paragraph(text, style)
        _, h = p.wrap(w, 1000)
        p.drawOn(c, x, y-h)
        return y-h

    for index, (language, data) in enumerate(COPY.items()):
        x, w = half*index+27, half-54
        top = height-28
        c.setFillColor(NAVY)
        c.setFont('Arial-Bold', 25)
        c.drawString(x, top-22, 'AlarmMini')
        c.setFillColor(BLUE)
        c.roundRect(x+w-36, top-24, 36, 20, 5, fill=1, stroke=0)
        c.setFillColor(HexColor('#FFFFFF'))
        c.setFont('Arial-Bold', 9)
        c.drawCentredString(x+w-18, top-18, language)
        paragraph(data['subtitle'], x, top-32, w, 8, GRAY, 10)
        c.setFillColor(HexColor('#E4B63A'))
        c.rect(x, top-52, 28, 2.5, fill=1, stroke=0)
        c.setFillColor(NAVY)
        c.setFont('Arial-Bold', 16)
        c.drawString(x, top-77, data['title'])
        y = paragraph(data['intro'], x, top-88, w, 9, GRAY, 12)-13
        for number, title, body in data['sections']:
            c.setFillColor(BLUE)
            c.setFont('Arial-Bold', 9)
            c.drawString(x, y-9, number)
            c.setFillColor(NAVY)
            c.setFont('Arial-Bold', 10.5)
            c.drawString(x+24, y-9, title)
            y = paragraph(body, x+24, y-16, w-24, 8.9, NAVY, 12)-8
        y = paragraph(data['help'], x, y, w, 8.2, GRAY, 10.5)-7
        y = paragraph(data['note'], x, y, w, 8, GRAY, 10.5)
        if y < 90:
            raise ValueError(f'{language}: content overlaps footer at {y:.1f}')
        c.setStrokeColor(HexColor('#DCE3E9'))
        c.line(x, 82, x+w, 82)
        widget = qr.QrCodeWidget(SITE)
        bounds = widget.getBounds()
        size = 48
        drawing = Drawing(size, size, transform=[size/(bounds[2]-bounds[0]),0,0,size/(bounds[3]-bounds[1]),0,0])
        drawing.add(widget)
        renderPDF.draw(drawing,c,x,30)
        paragraph('<b>'+data['qr']+'</b>', x+58, 72, w-58, 8.5, NAVY, 11)
        paragraph('<link href="'+SITE+'" color="#175B99">alarmmini.vercel.app</link>',x+58,58,w-58,9,BLUE,11)
        paragraph('<link href="'+SUPPORT+'" color="#175B99">'+data['support']+'</link>',x+58,44,w-58,8.5,BLUE,11)
        paragraph(data['footer'],x,21,w,6.6,GRAY,8)
    c.showPage()
    c.save()
    public = ROOT / 'vercel/public/downloads'
    public.mkdir(exist_ok=True)
    shutil.copy2(output, public/output.name)
    print(output)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--font-dir', type=Path, default=Path('C:/Windows/Fonts'))
    build(parser.parse_args().font_dir)
