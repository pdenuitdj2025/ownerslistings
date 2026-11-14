/* vresakinita — Greek/English switch. Greek is the source language; English is applied in the browser
   by translating text nodes and a few attributes, including content the pages create later. */
(function () {
  var LS = "vk-lang";
  function stored() { try { return localStorage.getItem(LS); } catch (e) { return null; } }
  var lang = stored() || (/^el/i.test(navigator.language || "el") ? "el" : "en");
  if (!stored() && !/^el/i.test(navigator.language || "")) lang = "en";

  var D = {
    /* ---- shared / navigation ---- */
    "Αρχική": "Home", "Σύνδεση": "Log in", "Εγγραφή γραφείου": "Register your office", "Επικοινωνία": "Contact",
    "Όροι": "Terms", "Απόρρητο": "Privacy", "Αποσύνδεση": "Log out", "Λογαριασμός": "Account", "Άνοιγμα εργαλείου": "Open the tool",
    "Κύρια πλοήγηση": "Main navigation", "Τι κάνει": "Features", "Πώς λειτουργεί": "How it works", "Τιμή": "Price",
    "Νομικές πληροφορίες & όροι": "Legal information & terms", "Πολιτική απορρήτου": "Privacy policy",
    "όρους": "terms", "όρους χρήσης": "terms of use", "πολιτική απορρήτου": "privacy policy", "Όροι χρήσης": "Terms of use",
    "φόρμα επικοινωνίας": "contact form", "και την": "and the", "Ετήσια": "Yearly", "Μηνιαία": "Monthly",
    "ετήσια": "yearly", "μηνιαία": "monthly", "/ μήνα": "/ month", "τον μήνα": "per month", "τον χρόνο": "per year", "τον χρόνο.": "per year.",
    /* ---- landing ---- */
    "vresakinita — Βρες ακίνητα πρώτος. Το εργαλείο για μεσιτικά γραφεία": "vresakinita — Find properties first. The tool for real estate offices",
    "Το εργαλείο για μεσιτικά γραφεία": "The tool for real estate offices",
    "Το εργαλείο για μεσιτικά γραφεία: ιδιώτες και μεσίτες, κατοικίες, οικόπεδα και ξενοδοχεία από όλη την Ελλάδα σε μία καθαρή λίστα που ενημερώνεται τρεις φορές την ημέρα.":
      "The tool for real estate offices: private sellers and agents, homes, land and hotels from all over Greece in one clean list, updated three times a day.",
    "Βρες ακίνητα.": "Find properties.", "Πρώτος.": "First.",
    "Κάθε νέο ακίνητο στην Ελλάδα, από ιδιώτες και μεσίτες, σε μία καθαρή λίστα που ενημερώνεται τρεις φορές την ημέρα.":
      "Every new property in Greece, from private sellers and agents, in one clean list updated three times a day.",
    "Δείτε πώς λειτουργεί": "See how it works", "Ξεκινήστε ως γραφείο": "Start as an office",
    "Ζωντανό δείγμα": "Live sample", "Ζωντανό δείγμα από τη σημερινή λίστα": "Live sample from today's list",
    "Πραγματικά ακίνητα από τη σημερινή λίστα, με στρογγυλεμένες τιμές. Στο εργαλείο: φωτογραφίες, πλήρη στοιχεία, φίλτρα και σύνδεσμος προς κάθε αγγελία.":
      "Real properties from today's list, with rounded prices. In the tool: photos, full details, filters and a link to every listing.",
    "Έτοιμο από την πρώτη μέρα": "Ready from day one", "Όλη η Ελλάδα": "All of Greece",
    "Όλες οι λίστες: κατοικίες, οικόπεδα, ξενοδοχεία": "Every list: homes, land, hotels",
    "Ιδιώτες και μεσίτες, σε όλη την Ελλάδα": "Private sellers and agents, all over Greece",
    "Ιδιώτες ή μεσίτες, με ένα κλικ": "Private sellers or agents, one click away",
    "Αλλάζετε προβολή αμέσως. Κατοικίες, οικόπεδα και ξενοδοχεία, κάθε κατηγορία στη δική της λίστα.":
      "Switch views instantly. Homes, land and hotels, each category in its own list.",
    "Τα ακίνητα που πωλούνται χωρίς μεσίτη, χωριστά από όλα τα άλλα. Με ένα κλικ ανοίγετε την αρχική αγγελία.":
      "Properties sold without an agent, separate from everything else. One click opens the original listing.",
    "Όλοι βλέπουν πρώτοι τα νέα ακίνητα": "Everyone sees new properties first",
    "Δείτε πρώτοι το επόμενο ακίνητο της περιοχής σας": "Be the first to see the next property in your area",
    "Αντί για δέκα καρτέλες και τις ίδιες αγγελίες ξανά και ξανά, μία λίστα που δουλεύει όπως δουλεύει το γραφείο σας.":
      "Instead of ten tabs and the same listings again and again, one list that works the way your office works.",
    "Λιγότερο ψάξιμο, περισσότερες αναθέσεις": "Less searching, more mandates",
    "Πάντα φρέσκο": "Always fresh", "Μία γραμμή ανά ακίνητο": "One row per property",
    "Νέες αγγελίες τρεις φορές την ημέρα. Όσες κατεβαίνουν, φεύγουν και από τη λίστα σας.":
      "New listings three times a day. Those that are taken down also leave your list.",
    "Το ίδιο ακίνητο σε πολλές ιστοσελίδες εμφανίζεται μία φορά. Μόνο αγγελίες με φωτογραφίες, τιμή και τετραγωνικά.":
      "The same property on several websites appears once. Only listings with photos, price and square metres.",
    "Κοινή λίστα για την ομάδα": "A shared list for the team", "Κοινές σημειώσεις και εξαγωγή στοιχείων": "Shared notes and data export",
    "Σημειώσεις και κατάσταση ανά αγγελία. Όλοι βλέπουν τι έχει ήδη δουλέψει συνάδελφος. Μόνο το γραφείο σας τα βλέπει.":
      "Notes and status per listing. Everyone sees what a colleague has already worked on. Only your office sees them.",
    "Υλικό για τη δική σας παρουσίαση": "Material for your own presentation",
    "Φιλτράρετε, επιλέγετε ακίνητα και εξάγετε τα στοιχεία τους. Την παρουσίαση στον πελάτη την ετοιμάζει και την κάνει ο μεσίτης, όχι το εργαλείο.":
      "Filter, pick properties and export their details. The client presentation is prepared and delivered by the agent, not by the tool.",
    "Κάθε πρωί η λίστα έχει ό,τι καινούργιο βγήκε. Ανοίγετε την αγγελία και κινείστε πρώτοι.":
      "Every morning the list has whatever is new. Open the listing and move first.",
    "Το γραφείο ανοίγει λογαριασμό": "The office opens an account", "Ανοίξτε τον λογαριασμό του γραφείου σας σε ένα λεπτό.": "Open your office account in one minute.",
    "Προσθέτει τους μεσίτες του": "Adds its agents",
    "Ο υπεύθυνος του γραφείου γράφεται και διαλέγει ετήσια ή μηνιαία συνδρομή. Χωρίς εγκατάσταση, από υπολογιστή ή κινητό.":
      "The office manager signs up and picks a yearly or monthly plan. Nothing to install, from computer or phone.",
    "Κερδίζετε": "You win", "Συνδρομή γραφείου": "Office subscription",
    "Μία συνδρομή για το γραφείο. Μία θέση για κάθε μεσίτη.": "One subscription for the office. One seat for each agent.",
    "Τη συνδρομή την κάνει το γραφείο. Οι μεσίτες του μπαίνουν με πρόσκληση, και πληρώνετε μόνο για όσους χρειάζεστε.":
      "The office takes the subscription. Its agents join by invitation, and you pay only for the ones you need.",
    "Περιλαμβάνει τον υπεύθυνο του γραφείου.": "Includes the office manager.",
    "Ξεκινήστε · από": "Get started · from", "Ακύρωση όποτε θέλετε": "Cancel any time",
    "Η πληρωμή γίνεται με ασφάλεια μέσω Stripe. Με τη συνδρομή αποδέχεστε τους": "Payment is processed securely through Stripe. By subscribing you accept the",
    "Υπολογίστε το κόστος σας": "Calculate your cost", "Μεσίτες:": "Agents:", "Τρόπος πληρωμής": "Billing",
    "Σύνολο τον μήνα": "Total per month", "Σύνολο τον χρόνο": "Total per year",
    "Χρέωση κάθε μήνα. Με το ετήσιο κερδίζετε": "Billed every month. With the yearly plan you save",
    "και την": "and the", "με μία χρέωση τον χρόνο.": "with one charge per year.",
    "€499 με μία χρέωση τον χρόνο.": "€499 with one charge per year.",
    "τον μήνα για κάθε μεσίτη": "per month for each agent",
    "τον μήνα για κάθε μεσίτη (": "per month for each agent (",
    "τον μήνα για κάθε μεσίτη (€149 τον χρόνο ανά θέση)": "per month for each agent (€149 per year per seat)",
    "τον χρόνο ανά θέση)": "per year per seat)", "θέσεις μεσιτών": "agent seats",
    "1 θέση μεσίτη": "1 agent seat", "3 θέσεις μεσιτών": "3 agent seats",
    "Συχνές ερωτήσεις": "Frequently asked questions", "Καλό να γνωρίζετε": "Good to know",
    "Από πού προέρχονται οι αγγελίες;": "Where do the listings come from?",
    "Από δημόσια δημοσιευμένες αγγελίες σε ελληνικές ιστοσελίδες ακινήτων. Το vresakinita τις οργανώνει σε μία λίστα και σας παραπέμπει πάντα στην αρχική αγγελία. Δεν είναι συνεργάτης των ιστοσελίδων αυτών.":
      "From publicly posted listings on Greek real estate websites. vresakinita organises them into one list and always sends you to the original listing. It is not a partner of those websites.",
    "Βλέπω τα τηλέφωνα των αγγελιών;": "Do I see the phone numbers in the listings?",
    "Όχι μέσα στο εργαλείο. Κάθε γραμμή έχει σύνδεσμο προς την αρχική αγγελία, όπου βρίσκονται τα στοιχεία επικοινωνίας που έχει δημοσιεύσει ο αγγελιοδότης.":
      "Not inside the tool. Every row links to the original listing, where the contact details published by the advertiser can be found.",
    "Φτιάχνει το εργαλείο την παρουσίαση για τον πελάτη μου;": "Does the tool make the presentation for my client?",
    "Όχι. Το εργαλείο σάς δίνει τα ακίνητα και τα στοιχεία τους οργανωμένα. Την παρουσίαση την ετοιμάζει και την κάνει ο μεσίτης.":
      "No. The tool gives you the properties and their details, organised. The presentation is prepared and delivered by the agent.",
    "Βλέπουν άλλα γραφεία τις σημειώσεις μας;": "Do other offices see our notes?",
    "Όχι. Οι σημειώσεις και η κατάσταση κάθε αγγελίας είναι ορατές μόνο στους χρήστες του δικού σας γραφείου.":
      "No. The notes and status of each listing are visible only to the users of your own office.",
    "Πώς χρεώνονται οι θέσεις των μεσιτών;": "How are agent seats charged?",
    "Κάθε θέση προστίθεται στη συνδρομή του γραφείου. Όταν προσθέτετε θέση μέσα στην περίοδο, χρεώνεστε αναλογικά μέχρι την επόμενη ανανέωση. Όταν αφαιρείτε θέση, η διαφορά πιστώνεται στον επόμενο λογαριασμό.":
      "Each seat is added to the office subscription. When you add a seat mid-period you are charged proportionally until the next renewal. When you remove a seat, the difference is credited to your next invoice.",
    "Πόσοι μεσίτες θα έχουν πρόσβαση, εκτός από τον υπεύθυνο;": "How many agents get access, besides the manager?",
    "Αγοράζει μία θέση για κάθε συνεργάτη και του στέλνει τον σύνδεσμο πρόσκλησης. Θέσεις προστίθενται ή αφαιρούνται όποτε χρειαστεί.":
      "Buy one seat per colleague and send them the invitation link. Seats can be added or removed whenever needed.",
    "Μπορεί να γραφτεί ένας μεσίτης μόνος του;": "Can an agent sign up alone?",
    "Τη συνδρομή την κάνει το μεσιτικό γραφείο. Ο υπεύθυνος του γραφείου αγοράζει μία θέση για κάθε μεσίτη και του στέλνει σύνδεσμο πρόσκλησης. Αν εργάζεστε μόνος σας, γράφεστε ως γραφείο ενός ατόμου, χωρίς επιπλέον θέσεις.":
      "The subscription is taken by the real estate office. The office manager buys a seat for each agent and sends them an invitation link. If you work alone, sign up as a one-person office, with no extra seats.",
    "Πώς ακυρώνω;": "How do I cancel?",
    "Από τη «Διαχείριση συνδρομής» στον λογαριασμό σας, όποτε θέλετε. Διατηρείτε την πρόσβαση μέχρι το τέλος της περιόδου που έχετε ήδη πληρώσει και δεν χρεώνεστε ξανά.":
      "From “Manage subscription” in your account, whenever you like. You keep access until the end of the period you have already paid for and are not charged again.",
    "Το vresakinita είναι εργαλείο αναζήτησης και οργάνωσης δημόσια δημοσιευμένων αγγελιών. Οι αγγελίες, οι φωτογραφίες και τα στοιχεία τους ανήκουν σε όσους τις δημοσίευσαν. Δεν συνδεόμαστε με τις ιστοσελίδες όπου δημοσιεύονται.":
      "vresakinita is a tool for searching and organising publicly posted listings. The listings, photos and details belong to those who published them. We are not affiliated with the websites where they are posted.",
    "Κατηγορία": "Category", "Κατοικίες": "Homes", "Οικόπεδα": "Land", "Ξενοδοχεία": "Hotels", "Ξενοδοχεία προς πώληση": "Hotels for sale",
    "Ιδιώτες": "Private sellers", "Μεσίτες": "Agents", "Από ιδιώτες": "From private sellers", "Από μεσίτες": "From agents", "Απευθείας από ιδιώτες": "Directly from private sellers",
    "Ιδιώτες και μεσίτες": "Private sellers and agents", "Πωλητής": "Seller", "Γραφείο": "Office", "Διαμέρισμα": "Apartment", "Μεζονέτα": "Maisonette",
    "Κέντρο Αθήνας": "Central Athens", "Νότια προάστια": "Southern suburbs", "Βόρεια προάστια": "Northern suburbs", "Θεσσαλονίκη": "Thessaloniki",
    "ΝΕΟ": "NEW", "τ.μ.": "sqm", "υπν.": "bd", "ΕΚΠΤΩΣΗ": "DISCOUNT",
    /* ---- tool ---- */
    "Ιδιώτες και μεσίτες · κατοικίες, οικόπεδα, ξενοδοχεία · μία γραμμή ανά ακίνητο": "Private sellers and agents · homes, land, hotels · one row per property",
    "Ιδιώτες και μεσίτες · κατοικίες, οικόπεδα, ξενοδοχεία · μία γραμμή ανά ακίνητο · τελευταίος έλεγχος": "Private sellers and agents · homes, land, hotels · one row per property · last check",
    "Περιοχή ή γειτονιά": "Area or neighbourhood", "(πολλές, χωρισμένες με κόμμα)": "(several, separated by commas)",
    "π.χ. Γλυφάδα, Βούλα, Βάρη, Κυψέλη": "e.g. Glyfada, Voula, Vari, Kypseli",
    "Δήμος": "Municipality", "Δήμοι:": "Municipalities:", "Όλη η Αττική": "All of Attica", "Καθαρισμός": "Clear", "Κλείσιμο": "Close",
    "Τύπος": "Type", "Τύπος:": "Type:", "Όλοι": "All", "Ελάχ. τιμή €": "Min. price €", "Μέγ. τιμή €": "Max. price €",
    "Ελάχ. τ.μ.": "Min. sqm", "Μέγ. τ.μ.": "Max. sqm", "χωρίς όριο": "no limit", "Όροφοι": "Floors", "Όλοι οι όροφοι": "All floors",
    "Ιστότοπος": "Website", "Ιστότοπος:": "Website:", "Όλοι οι ιστότοποι": "All websites", "Ταξινόμηση": "Sort", "Νεότερες πρώτα": "Newest first",
    "Τιμή ↑": "Price ↑", "Τιμή ↓": "Price ↓", "€/τ.μ. ↑": "€/sqm ↑", "Φίλτρα": "Filters", "Κατάσταση": "Status",
    "Προς έλεγχο": "To review", "Επικοινωνήσαμε": "Contacted", "Δεν ενδιαφέρει": "Not interested", "Όλες": "All",
    "Επιλογή όλων": "Select all", "Καθαρισμός επιλογής": "Clear selection",
    "Επιλογή όλων των αγγελιών που φαίνονται με τα τρέχοντα φίλτρα": "Select all listings shown with the current filters",
    "Αντιγραφή για Claude": "Copy for Claude", "Αντιγραφή της λίστας (με τα τρέχοντα φίλτρα) για επικόλληση στο Claude": "Copy the list (with the current filters) to paste into Claude",
    "Λήψη ZIP (με φωτογραφίες)": "Download ZIP (with photos)", "ZIP με κείμενο και φωτογραφίες υψηλής ανάλυσης, για παρουσίαση": "ZIP with text and high-resolution photos, for a presentation",
    "Για εξαγωγή": "For export", "Σημείωση (τηλέφωνο, αποτέλεσμα κλήσης…)": "Note (call result, follow-up…)",
    "Άνοιγμα αγγελίας": "Open listing", "Άνοιγμα αγγελίας στο": "Open listing on", "Αγγελία": "Listing", "Αγγελία ιδιώτη": "Private seller listing",
    "Παράλειψη": "Skip", "Επέστρεψε στον έλεγχο": "Back to review", "Περισσότερα": "More", "Φωτογραφίες": "Photos", "Φωτογραφίες…": "Photos…",
    "Τιμή/τ.μ.": "Price/sqm", "Τιμή:": "Price:", "Εμβαδόν": "Area", "Εμβαδόν:": "Area:", "Εμβαδόν οικοπέδου": "Plot area",
    "Υπνοδωμάτια": "Bedrooms", "Μπάνια": "Bathrooms", "Όροφος": "Floor", "Έτος κατασκευής": "Year built", "Έτος ανακαίνισης": "Year renovated",
    "Ενεργειακή κλάση": "Energy class", "Θέρμανση": "Heating", "Σύστημα θέρμανσης": "Heating system", "Διεύθυνση": "Address", "Δημοσίευση": "Published",
    "Ενημέρωση": "Updated", "Τελευταία ενημέρωση": "Last update", "Διαθέσιμο από": "Available from", "Κατασκευή": "Construction", "Επίπεδα": "Levels",
    "Κουζίνες": "Kitchens", "Σαλόνια": "Living rooms", "Καθιστικά": "Sitting rooms", "Πάρκινγκ": "Parking", "Ζώνη": "Zone", "Μεσιτική αμοιβή": "Agent fee",
    "Στην αγορά": "On the market", "Νομός": "Prefecture", "Περιοχή": "Area", "Κωδικός αγγελίας": "Listing ref.", "vs περιοχή": "vs area", "μέσος": "avg", "βρέθηκε": "found", "δημοσιεύτηκε": "published", "Realting (σε $)": "Realting (in $)", "Χρήση": "Use", "Και σε": "Also on", "Αττική": "Attica", "Στοιχεία:": "Details:", "Οδηγίες:": "Instructions:",
    "Υπόγειο": "Basement", "Ημιυπόγειο": "Semi-basement", "Ισόγειο": "Ground floor",
    "Νέες σήμερα": "New today", "νέες σήμερα": "new today", "προς έλεγχο": "to review", "επικοινωνήσαμε": "contacted", "νέες": "new",
    "σήμερα": "today", "ακίνητα": "properties", "φωτογραφίες": "photos", "χωρίς φίλτρα": "no filters", "δήμοι επιλεγμένοι": "municipalities selected",
    "όροφοι επιλεγμένοι": "floors selected", "επιλεγμένα για εξαγωγή:": "selected for export:", "εξαγωγή: όλα τα εμφανιζόμενα (": "export: everything shown (",
    "· Ημερομηνία:": "· Date:", "· Φίλτρα:": "· Filters:", "· Λογαριασμός": "· Account", "· τιμές από": "· prices from",
    "Μόνο ιδιώτες (απόκρυψη ομαδοποιημένων αγγελιών με μεσίτες)": "Private sellers only (hide grouped listings that include agents)",
    "Ομαδοποιημένη · ιδιώτης + άλλοι": "Grouped · private seller + others",
    "Φόρτωση αγγελιών… Οι νέες αγγελίες ιδιωτών εμφανίζονται εδώ μετά από κάθε έλεγχο.": "Loading listings… New private listings appear here after each check.",
    "Δεν υπάρχουν αγγελίες ακόμα. Ο πρώτος ημερήσιος έλεγχος θα γεμίσει τη λίστα με κατοικίες ιδιωτών προς πώληση στην Αττική.": "No listings yet. The first daily check will fill the list with private homes for sale in Attica.",
    "Δεν υπάρχουν ακόμα αγγελίες σε αυτή την κατηγορία. Η σάρωση νέων κατηγοριών προστίθεται σταδιακά.": "There are no listings in this category yet. Scanning of new categories is being added gradually.",
    "Καμία αγγελία δεν ταιριάζει με αυτά τα φίλτρα. Δοκίμασε να καθαρίσεις την περιοχή ή την τιμή.": "No listing matches these filters. Try clearing the area or the price.",
    "Δεν υπάρχουν αγγελίες για εξαγωγή": "There are no listings to export", "Η λίστα δεν φορτώθηκε. Ξαναφόρτωσε τη σελίδα.": "The list did not load. Reload the page.",
    "Δεν αποθηκεύτηκε. Έλεγξε τη σύνδεσή σου και ξαναδοκίμασε.": "Not saved. Check your connection and try again.",
    "Η σημείωση αποθηκεύτηκε": "Note saved", "Σημειώθηκε: δεν ενδιαφέρει": "Marked: not interested", "Σημειώθηκε: επικοινωνήσαμε": "Marked: contacted",
    "Αντιγράφηκαν": "Copied", "Η αντιγραφή δεν επιτράπηκε — κατέβηκε αρχείο .md": "Copying was not allowed — an .md file was downloaded",
    "Η δημιουργία του ZIP απέτυχε. Δοκίμασε με λιγότερα ακίνητα.": "Creating the ZIP failed. Try with fewer properties.",
    "Μια άλλη εξαγωγή τρέχει ακόμα — δοκίμασε σε λίγο.": "Another export is still running — try again shortly.",
    "Προετοιμασία…": "Preparing…", "Κατέβηκε ZIP —": "ZIP downloaded —", "Κατέβηκε CSV με": "CSV downloaded with", "Κατέβηκε JSON με": "JSON downloaded with",
    "απαιτεί σύνδεση": "requires sign-in", "μπλοκαρίστηκε από έλεγχο ρομπότ": "blocked by bot check", "ο έλεγχος απέτυχε": "the check failed",
    "δεν διαβάστηκαν αγγελίες": "no listings were read", "βρέθηκε πριν <1 ώρα": "found <1 h ago", "δημοσιεύτηκε": "published",
    "ημέρες": "days", "έτος": "year", "ακίνητα)": "properties)", "ακίνητα —": "properties —", "ακίνητα — επικόλλησέ τα στο Claude": "properties — paste them into Claude",
    "Περισσότερα (απομένουν": "More (remaining",
    /* ---- account / login / signup / contact / billing (server pages) ---- */
    "Συνδεθείτε στον λογαριασμό σας.": "Log in to your account.", "Κωδικός": "Password", "Λάθος email ή κωδικός.": "Wrong email or password.",
    "Είστε μεσιτικό γραφείο χωρίς λογαριασμό;": "A real estate office without an account?", "Είστε συνεργάτης; Ζητήστε τον σύνδεσμο πρόσκλησης από το γραφείο σας.": "Are you an agent? Ask your office for the invitation link.",
    "Ξεχάσατε τον κωδικό; Γράψτε μας από τη": "Forgot your password? Write to us through the", "ή με email": "or with email",
    "Συνέχεια με Google": "Continue with Google", "Συνέχεια με Apple": "Continue with Apple", "Είσοδος ομάδας": "Team login", "Κωδικός ομάδας": "Team password", "Λάθος κωδικός": "Wrong password",
    "Έχετε ήδη λογαριασμό;": "Already have an account?", "Όνομα γραφείου": "Office name", "Επωνυμία γραφείου": "Office name", "Επωνυμία": "Business name",
    "Ονοματεπώνυμο": "Full name", "Κωδικός (τουλάχιστον 8 χαρακτήρες)": "Password (at least 8 characters)", "Νέος κωδικός": "New password", "Νέος κωδικός (τουλάχιστον 8 χαρακτήρες)": "New password (at least 8 characters)",
    "Αποδέχομαι τους": "I accept the", "Με τη σύνδεση αποδέχεστε τους": "By logging in you accept the", "Χρειάζεται η αποδοχή των όρων.": "You need to accept the terms.",
    "Συμπληρώστε όλα τα πεδία.": "Fill in all fields.", "Γράψτε ένα έγκυρο email.": "Enter a valid email.", "Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.": "The password needs at least 8 characters.",
    "Υπάρχει ήδη λογαριασμός με αυτό το email. Συνδεθείτε.": "An account with this email already exists. Please log in.",
    "Τη συνδρομή την ανοίγει το μεσιτικό γραφείο. Μετά προσθέτετε τους συνεργάτες σας, έναν έναν, από τον λογαριασμό σας.": "The subscription is opened by the real estate office. Then you add your colleagues, one by one, from your account.",
    "Πολλές προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.": "Too many attempts. Try again in 15 minutes.", "Πολλές προσπάθειες. Δοκιμάστε ξανά σε λίγο.": "Too many attempts. Try again shortly.",
    "Η σύνδεση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.": "Sign-in was not completed. Try again.", "Η σύνδεση με Apple απέτυχε. Δοκιμάστε ξανά.": "Sign-in with Apple failed. Try again.", "Η σύνδεση με Google απέτυχε. Δοκιμάστε ξανά.": "Sign-in with Google failed. Try again.",
    "Ο πάροχος δεν μας έδωσε email. Δοκιμάστε ξανά ή εγγραφείτε με email.": "The provider did not give us an email. Try again or sign up with email.",
    "Ο σύνδεσμος έληξε": "The link has expired", "Ζητήστε νέο σύνδεσμο από τη": "Request a new link from the",
    "Συμμετοχή": "Join", "Συμμετοχή στο γραφείο": "Join the office", "Το email σας": "Your email",
    "Θα δουλεύετε στην ίδια λίστα με τους συναδέλφους σας. Η θέση σας έχει ήδη καλυφθεί από το γραφείο.": "You will work in the same list as your colleagues. Your seat is already covered by the office.",
    "Το γραφείο δεν έχει ελεύθερη θέση συνεργάτη αυτή τη στιγμή. Ζητήστε από τον υπεύθυνο του γραφείου να προσθέσει μία θέση και ανοίξτε ξανά τον σύνδεσμο.": "The office has no free agent seat right now. Ask the office manager to add a seat, then open the link again.",
    "Η ομάδα": "The team", "Ομάδα": "Team", "Θέσεις συνεργατών:": "Agent seats:", "Συνολικές θέσεις συνεργατών": "Total agent seats", "Ενημέρωση θέσεων": "Update seats",
    "Αφαίρεση": "Remove", "Αποθήκευση": "Save", "· ελεύθερες": "· free", "· σε χρήση": "· in use", "· θέση συνεργάτη": "· agent seat", "· υπεύθυνος γραφείου": "· office manager",
    "Αφαιρέστε πρώτα συνεργάτες: οι θέσεις δεν μπορούν να είναι λιγότερες από τους συνεργάτες που έχετε.": "Remove colleagues first: seats cannot be fewer than the colleagues you have.",
    "Προσθέστε πρώτα μία θέση συνεργάτη. Μετά στείλτε": "First add an agent seat. Then send", "Στείλτε": "Send",
    "αυτόν τον σύνδεσμο στον συνεργάτη σας. Όποιος εγγραφεί με αυτόν μπαίνει στη λίστα του γραφείου και πιάνει μία θέση.": "this link to your colleague. Whoever signs up with it joins the office list and takes one seat.",
    ". Όταν προσθέτετε θέση, χρεώνεται αμέσως η αναλογία μέχρι την επόμενη ανανέωση.": ". When you add a seat, the proportional amount until the next renewal is charged immediately.",
    "Διαχείριση συνδρομής (κάρτα, τιμολόγια, ακύρωση)": "Manage subscription (card, invoices, cancellation)", "Δεν υπάρχει ενεργή συνδρομή.": "There is no active subscription.",
    "Η συνδρομή του γραφείου δεν είναι ενεργή.": "The office subscription is not active.", "Η συνδρομή του γραφείου είναι ενεργή (": "The office subscription is active (", "Η πρόσβασή σας είναι ενεργή.": "Your access is active.",
    "Επικοινωνήστε με τον υπεύθυνο του γραφείου σας.": "Contact your office manager.", "Έχει ακυρωθεί και λήγει στις": "Cancelled, ends on", "Επόμενη ανανέωση στις": "Next renewal on",
    "Η τελευταία χρέωση απέτυχε· ενημερώστε την κάρτα σας.": "The last charge failed; please update your card.",
    "Ξεκινήστε τη συνδρομή του γραφείου για να ανοίξετε το εργαλείο.": "Start the office subscription to open the tool.", "Συνέχεια στην πληρωμή": "Continue to payment",
    "Ετήσια συνδρομή": "Yearly subscription", "Μηνιαία συνδρομή": "Monthly subscription", "συνδρομή γραφείου": "office subscription",
    "Οι πληρωμές ενεργοποιούνται σύντομα. Δοκιμάστε ξανά σε λίγο.": "Payments are being activated soon. Try again shortly.", "Η ενέργεια δεν ολοκληρώθηκε. Δοκιμάστε ξανά.": "The action was not completed. Try again.",
    "Απαντάμε με email. Έχετε ερώτηση για τη συνδρομή σας, μια πληρωμή, τα δεδομένα σας ή το εργαλείο; Γράψτε μας εδώ.": "We reply by email. Have a question about your subscription, a payment, your data or the tool? Write to us here.",
    "Το όνομά σας": "Your name", "Το μήνυμά σας": "Your message", "Αποστολή μηνύματος": "Send message", "Αποστολή…": "Sending…",
    "Αφήστε αυτό το πεδίο κενό": "Leave this field empty", "Ελέγξτε τα πεδία και δοκιμάστε ξανά.": "Check the fields and try again.",
    "Συμπληρώστε όνομα, έγκυρο email και μήνυμα τουλάχιστον 10 χαρακτήρων.": "Enter a name, a valid email and a message of at least 10 characters.",
    "Το μήνυμά σας στάλθηκε. Θα σας απαντήσουμε με email.": "Your message was sent. We will reply by email.", "Το μήνυμα δεν στάλθηκε. Δοκιμάστε ξανά σε λίγο.": "The message was not sent. Try again shortly.",
    "Στείλατε πολλά μηνύματα. Δοκιμάστε ξανά αργότερα.": "You have sent many messages. Try again later.", ": μήνυμα από": ": message from"
  };

  var DAYS = { "Κυρ":"Sun","Δευ":"Mon","Τρί":"Tue","Τετ":"Wed","Πέμ":"Thu","Παρ":"Fri","Σάβ":"Sat" };
  var MON = { "Ιαν":"Jan","Φεβ":"Feb","Μαρ":"Mar","Απρ":"Apr","Μαΐ":"May","Μάι":"May","Ιουν":"Jun","Ιούν":"Jun","Ιουλ":"Jul","Ιούλ":"Jul","Αυγ":"Aug","Αύγ":"Aug","Σεπ":"Sep","Οκτ":"Oct","Νοε":"Nov","Δεκ":"Dec" };
  var RX = [
    [/βρέθηκε πριν <1 ώρα/g, "found <1 h ago"], [/βρέθηκε πριν (\d+) ω\./g, "found $1 h ago"], [/βρέθηκε πριν (\d+) ημ\./g, "found $1 d ago"],
    [/πριν (\d+) (?:ημ\.|μέρες|μέρα)/g, "$1 d ago"], [/πριν (\d+) ω\./g, "$1 h ago"], [/(\d+)ος όροφος/g, "Floor $1"], [/όροφος (\d+)ος?/g, "floor $1"], [/έτος (\d+)/g, "built $1"],
    [/(\d+) υ\/δ/g, "$1 bd"], [/(\d[\d.,]*) τ\.μ\./g, "$1 sqm"], [/\/τ\.μ\./g, "/sqm"],
    [/^(\d+) θέσεις? μεσιτ(?:ών|η)$/, "$1 agent seat(s)"], [/^(\d+) ώρες?$/, "$1 h"], [/^Ενημερώθηκε (.+)$/, "Updated $1"],
    [/(\s)μ\.μ\./g, "$1PM"], [/(\s)π\.μ\./g, "$1AM"],
    [/(^|[\s,])(Κυρ|Δευ|Τρί|Τετ|Πέμ|Παρ|Σάβ)(?=[\s,.]|$)\.?/g, function (m, a, d) { return a + DAYS[d]; }],
    [/(^|[\s,])(Ιαν|Φεβ|Μαρ|Απρ|Μαΐ|Μάι|Ιούν|Ιουν|Ιούλ|Ιουλ|Αύγ|Αυγ|Σεπ|Οκτ|Νοε|Δεκ)(?=[\s,.]|$)\.?/g, function (m, a, d) { return a + MON[d]; }]
  ];
  var keys = Object.keys(D).filter(function (k) { return k.length > 3; }).sort(function (a, b) { return b.length - a.length; });
  var GR = /[Α-Ωα-ωά-ώΐΰ]/;

  function tr(s) {
    if (!s || !GR.test(s)) return s;
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/), core = m[2];
    if (D[core] != null) return m[1] + D[core] + m[3];
    var out = core, i, k;
    for (i = 0; i < RX.length; i++) out = out.replace(RX[i][0], RX[i][1]);
    if (GR.test(out)) for (i = 0; i < keys.length; i++) { k = keys[i]; if (out.indexOf(k) > -1) out = out.split(k).join(D[k]); if (!GR.test(out)) break; }
    return m[1] + out + m[3];
  }

  var orig = new WeakMap(), origAttr = new WeakMap(), busy = false;
  var ATTRS = ["placeholder", "title", "aria-label", "alt", "content"];
  function node(n) {
    if (n.nodeType === 3) {
      var p = n.parentNode; if (!p || /^(SCRIPT|STYLE|TEXTAREA|CODE)$/.test(p.nodeName)) return;
      if (lang === "en") {
        var cur = n.nodeValue, o = orig.get(n);
        if (o === undefined || (cur !== o.en)) { if (GR.test(cur)) { var e = tr(cur); orig.set(n, { gr: cur, en: e }); if (e !== cur) n.nodeValue = e; } }
      } else { var o2 = orig.get(n); if (o2 && n.nodeValue === o2.en) { n.nodeValue = o2.gr; } orig.delete(n); }
    } else if (n.nodeType === 1) {
      if (/^(SCRIPT|STYLE)$/.test(n.nodeName)) return;
      var a, v, rec;
      for (a = 0; a < ATTRS.length; a++) {
        if (ATTRS[a] === "content" && !(n.nodeName === "META" && /description/.test(n.getAttribute("name") || ""))) continue;
        v = n.getAttribute && n.getAttribute(ATTRS[a]);
        rec = origAttr.get(n) || {};
        if (lang === "en") { if (v && GR.test(v)) { rec[ATTRS[a]] = v; origAttr.set(n, rec); n.setAttribute(ATTRS[a], tr(v)); } }
        else if (rec[ATTRS[a]]) { n.setAttribute(ATTRS[a], rec[ATTRS[a]]); delete rec[ATTRS[a]]; }
      }
      for (var c = n.firstChild; c; c = c.nextSibling) node(c);
    }
  }
  function title() {
    if (lang === "en") { if (GR.test(document.title)) { if (!window.__vkT) window.__vkT = document.title; document.title = tr(document.title); } }
    else if (window.__vkT) { document.title = window.__vkT; window.__vkT = null; }
  }
  function apply() {
    busy = true; try { document.documentElement.lang = lang; node(document.documentElement); title(); } finally { busy = false; }
  }
  var mo = new MutationObserver(function (list) {
    if (busy || lang !== "en") return; busy = true;
    try { list.forEach(function (r) { if (r.type === "characterData") node(r.target); else r.addedNodes.forEach(node); if (r.type === "attributes") node(r.target); }); } finally { busy = false; }
  });

  function set(l) { lang = l; try { localStorage.setItem(LS, l); } catch (e) {} document.cookie = "lang=" + l + ";path=/;max-age=31536000;samesite=lax"; apply(); paint(); }
  var sw;
  function paint() { if (!sw) return; var b = sw.querySelectorAll("button"); b[0].setAttribute("aria-pressed", lang === "el"); b[1].setAttribute("aria-pressed", lang === "en"); }
  function mount() {
    sw = document.createElement("div"); sw.className = "vk-lang"; sw.setAttribute("role", "group"); sw.setAttribute("aria-label", "Language");
    sw.innerHTML = '<button type="button" data-l="el">EL</button><button type="button" data-l="en">EN</button>';
    sw.addEventListener("click", function (e) { var l = e.target.getAttribute && e.target.getAttribute("data-l"); if (l) set(l); });
    var st = document.createElement("style");
    st.textContent = ".vk-lang{display:inline-flex;gap:2px;padding:3px;border-radius:999px;background:rgba(127,150,180,.16);font:700 12px/1 Manrope,system-ui,sans-serif;vertical-align:middle;margin-left:10px;flex:none}" +
      ".vk-lang button{all:unset;cursor:pointer;padding:6px 10px;border-radius:999px;color:inherit;opacity:.7}.vk-lang button[aria-pressed=true]{background:#0A5A9A;color:#fff;opacity:1}" +
      ".vk-lang button:focus-visible{outline:2px solid #3FA0DC;outline-offset:1px}.vk-lang.fixed{position:fixed;right:14px;bottom:14px;z-index:99;background:#fff;box-shadow:0 4px 18px rgba(12,44,82,.22);color:#0C2C52;margin:0}";
    document.head.appendChild(st);
    var host = document.querySelector(".nav .container") || document.querySelector(".topbar>div") || document.querySelector(".top");
    if (host) host.appendChild(sw); else { sw.className += " fixed"; document.body.appendChild(sw); }
    paint();
  }
  function start() {
    mount(); apply();
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  window.vkLang = { set: set, get: function () { return lang; }, t: tr };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
