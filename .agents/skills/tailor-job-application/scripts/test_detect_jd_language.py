#!/usr/bin/env python3

from detect_jd_language import analyze_jd_language


german = """
Wir suchen einen Analysten für unser Team. Deine Aufgaben umfassen die Analyse von
Geschäftsprozessen und die Zusammenarbeit mit verschiedenen Fachbereichen. Du verfügst
über ein abgeschlossenes Studium und erste Erfahrung im Finanzbereich. Sehr gute
Kenntnisse in Excel sowie sichere Kommunikation sind für diese Position wichtig.
Wir bieten dir Verantwortung, Weiterbildung und flexible Arbeitszeiten. Deine Bewerbung
sendest du bitte mit deinen Unterlagen an unser Recruiting-Team. Die Aufgaben werden
gemeinsam mit den Kollegen priorisiert und du unterstützt bei der Umsetzung unserer Ziele.
"""

english = """
We are looking for an analyst to join our team. Your responsibilities include analyzing
business processes and working with finance stakeholders. You have a completed degree,
some experience in financial services, and strong Excel skills. The role offers ownership,
learning opportunities, and flexible working arrangements. Please send your application
to our recruiting team. You will support project delivery, prepare reports, and work with
colleagues across the organization to improve our operations and customer outcomes.
"""

mixed = """
We are looking for a finance analyst to join our international team. The role includes
reporting, planning, and process improvement across several markets. You will work with
English-speaking stakeholders and prepare management reports. The posting is based in
Deutschland and welcomes all applicants m/w/d. German knowledge is helpful, but the
working language and the full job description are English. You should have analytical
skills, relevant experience, and an interest in technology and financial operations.
"""

assert analyze_jd_language(german)["is_german"] is True
assert analyze_jd_language(german)["reason_code"] == "JD_LANGUAGE_GERMAN"
assert analyze_jd_language(english)["is_german"] is False
assert analyze_jd_language(mixed)["is_german"] is False

print("JD language detection tests passed")
