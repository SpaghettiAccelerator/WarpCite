#import "dhbw.typ" : * 
#import "acronyms.typ": *

#show: dhbw.with(
  title: "Test",
  authors: (
    (
      name: "Felix Wieland",
      student-id: "",
      course: "-",
      course-of-studies: "-",
      company: (
        (name: "-", post-code: "-", city: "-", country: "-")
      ),
    ),
  ),
  language: "de", // en, de
  show-confidentiality-statement: false,
  show-declaration-of-authorship: true,
  show-table-of-contents: true,
  show-acronyms: true,
  show-list-of-figures: true,
  show-list-of-tables: true,
  show-code-snippets: false,
  show-appendix: true,
  show-abstract: true,
  show-header: true,
  numbering-style: "1 von 1",
  numbering-alignment: center,
  // abstract: abstract,
  // appendix: appendix,
  acronyms: acronyms,
  date: datetime.today(),
  bibliography: bibliography("sources.bib"),
  // logo-center: image("assets/logos/thalescope-logo.svg"),
  // logo-left: image("assets/logos/thalescope-logo.svg"),
  // logo-right: image("assets/logos/suedpack.png"),
  logo-size-ratio: "3:1", // ratio between the right logo and the left logo height (left-logo:right-logo) only the right logo is resized
)

Test 

#dhbwCite("examplesource1", page: 1, highlight: (10,20))
#dhbwCite("examplesource1", page: 3, highlight: (10,20))
#dhbwCite("examplesource1", highlight: (10,20), page: 1)
#dhbwCite("examplesource1", page: 1)
#dhbwCite("examplesource1", page: 4)
#dhbwCite("examplesource1")