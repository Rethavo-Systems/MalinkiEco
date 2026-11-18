"""Small mail template without scripts, remote fonts or tracking images."""

from html import escape


def email_html(subject, body):
    paragraphs = "".join(
        '<p style="margin:0 0 16px;line-height:1.65">'
        + escape(part).replace("\n", "<br>")
        + "</p>"
        for part in body.split("\n\n")
    )
    return f"""<!doctype html><html lang="ru"><meta charset="utf-8">
<body style="margin:0;background:#eef1f6;font-family:Arial,sans-serif;color:#344455">
<table role="presentation" width="100%"><tr><td align="center" style="padding:28px 16px">
<table role="presentation" width="560" style="width:100%;max-width:560px;border-spacing:0">
<tr><td style="padding:0 4px 18px;font-size:14px">RETHAVO SYSTEMS</td></tr>
<tr><td style="height:5px;background:#a384a3;background:linear-gradient(100deg,#b388a4,#779cb8)"></td></tr>
<tr><td style="padding:30px 26px;background:#fff;border-radius:0 0 14px 14px">
<p style="font-size:12px;color:#775b79">MalinkiEco · Личный кабинет</p>
<h1 style="font-size:24px;color:#223142;font-weight:600">{escape(subject)}</h1>
<div style="font-size:15px">{paragraphs}</div></td></tr>
<tr><td style="padding:20px 4px;font-size:12px;color:#566778">Rethavo Systems · info@rethavo.ru</td></tr>
</table></td></tr></table></body></html>"""
