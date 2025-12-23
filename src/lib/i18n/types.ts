export type Language = 'nb' | 'sv' | 'en'

export const LANGUAGES: { code: Language; name: string; flag: string }[] = [
  { code: 'nb', name: 'Norsk', flag: '🇳🇴' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
]

export const DEFAULT_LANGUAGE: Language = 'nb'

export interface TranslationStrings {
  // Navigation
  nav: {
    home: string
    weekPlan: string
    feed: string
    recipes: string
    rememberList: string
    shoppingList: string
    settings: string
    admin: string
    logout: string
    more: string
  }

  // Common
  common: {
    save: string
    cancel: string
    delete: string
    edit: string
    add: string
    close: string
    loading: string
    error: string
    success: string
    confirm: string
    yes: string
    no: string
    or: string
    and: string
    optional: string
    required: string
    search: string
    noResults: string
    retry: string
    back: string
    next: string
    skip: string
    done: string
    today: string
    yesterday: string
    tomorrow: string
    day: string
    days: string
    week: string
    month: string
    year: string
    dismiss: string
    accept: string
    previousDay: string
    nextDay: string
    remove: string
    saving: string
    pending: string
    syncing: string
    sync: string
    offline: string
    backOnline: string
    creating: string
    finish: string
    items: string
    confirmDelete: string
    free: string
    navigatedTo: string
  }

  // Date/Time
  date: {
    weekdays: string[]
    weekdaysShort: string[]
    months: string[]
    monthsShort: string[]
    weekLabel: string // "Uke" / "Vecka" / "Week"
    weekFormat: string // "Uke {week}, {year}"
    birthday: string // "{name} fyller år" / "{name}'s birthday"
  }

  // Home page
  home: {
    welcome: string // "Velkommen til Familjen!"
    todayOverview: string
    noPickupsToday: string
    noMealPlanned: string
    noTasksToday: string
    pickup: string
    pickups: string
    meal: string
    task: string
    tasks: string
    event: string
    events: string
    picksUp: string // "{name} henter"
    everyoneHome: string
    memberAway: string
    membersAway: string
    birthdayWishes: string // "Happy birthday!" / "Gratulerer med dagen!"
    allReadyForToday: string // "All ready for today"
    thingNeedsAttention: string // "1 thing needs attention"
    thingsNeedAttention: string // "{count} things need attention"
    missingPickup: string // "Missing pickup"
    missingPickupFor: string // "Missing pickup for {name}"
    missingDinner: string // "Missing dinner plan"
    missingPickupAndDinner: string // "Missing pickup and dinner"
    missingPickupForAndDinner: string // "Missing pickup for {name} and dinner"
    // AI Heads Up section
    headsUp: string // "This week"
    headsUpItemSingular: string // "alert"
    headsUpItemPlural: string // "alerts"
    headsUpSource: string // "Based on messages and calendar"
    headsUpConflict: string // "Pickup conflict"
    headsUpSourceSuggestion: string // "Message"
    headsUpSourceClosure: string // "School calendar"
    headsUpSourceTask: string // "Tasks"
    headsUpSourceMemberEvent: string // "Calendar"
  }

  // Login page
  login: {
    title: string
    subtitle: string
    emailLabel: string
    emailPlaceholder: string
    continueWithGoogle: string
    sendMagicLink: string
    sendCode: string
    sending: string
    checkEmail: string
    checkEmailDesc: string
    enterCode: string
    enterCodeDesc: string
    orClickLink: string
    verifying: string
    invalidCode: string
    codeExpired: string
    resendCode: string
    differentEmail: string
    secureLogin: string
    errorNotAllowed: string
    errorAuthFailed: string
    errorGeneric: string
  }

  // Week planner
  week: {
    title: string
    editPickup: string
    editMeal: string
    addEvent: string
    editEvent: string
    addTask: string
    editTask: string
    copyLastWeek: string
    copyLastWeekConfirm: string
    clearWeek: string
    clearWeekConfirm: string
    quickPickup: string
    quickPickupConfirm: string
    weekContext: string
    weekContextPlaceholder: string
    noPickup: string
    customMeal: string
    selectRecipe: string
    selectPicker: string
    selectChild: string
    selectMember: string
    targetChild: string
    targetAdult: string
    aiSuggestions: string
    getAiSuggestions: string
    generating: string
    applyAll: string
    applySuggestion: string
    noSuggestions: string
    eventTitle: string
    eventType: string
    eventTypes: {
      work: string
      travel: string
      family: string
      other: string
    }
    startDate: string
    endDate: string
    taskTitle: string
    taskType: string
    taskTypes: {
      bring: string
      appointment: string
      reminder: string
      activity: string
      closure: string
      other: string
    }
    taskTime: string
    taskNotes: string
    markDone: string
    markUndone: string
    sendToWorkCalendar: string
    removeFromWorkCalendar: string
    more: string // "+{count} more"
    showLess: string
    calendar: string
    family: string  // "Familien" - Family row label
    familyEvent: string  // "Familiehendelse" - Family event
    icsEventReadOnly: string  // Warning for ICS synced events
    // AI Modal
    aiModalTitle: string
    suggestions: string
    generatingSuggestions: string
    takesAFewSeconds: string
    couldNotGenerate: string
    dishName: string
    addIngredient: string
    ingredient: string
    amount: string
    saveAsRecipe: string
    useThis: string
    editAndSave: string
    noDaysNeedSuggestions: string
    use: string
    addToShoppingList: string
    ingredientsAdded: string
    noIngredients: string
    // External suggestions
    suggestion: string
    reviewSuggestions: string
    remaining: string
    originalMessage: string
    calendarEvent: string
    aiSuggestion: string
    confidence: string
    noMoreSuggestions: string
    allSuggestionsReviewed: string
  }

  // Settings page
  settings: {
    title: string
    subtitle: string
    // Section headers
    familyTitle: string
    familyDesc: string
    mySettingsTitle: string
    mySettingsDesc: string
    integrationsTitle: string
    integrationsDesc: string
    aiPreferencesTitle: string
    aiPreferencesDesc: string
    administrationTitle: string
    administrationDesc: string
    // Legacy
    household: string
    householdName: string
    members: string
    addMember: string
    editMember: string
    memberName: string
    memberShortName: string
    memberEmail: string
    memberWorkEmail: string
    memberBirthDate: string
    memberAllergies: string
    isParent: string
    isParentDesc: string
    isHouseholdAdmin: string
    children: string
    addChild: string
    editChild: string
    childName: string
    childBirthDate: string
    childLocation: string
    childLocationType: string
    childLocationTypes: {
      kindergarten: string
      school: string
    }
    childColor: string
    childAllergies: string
    profile: string
    language: string
    selectLanguage: string
    dangerZone: string
    deleteChild: string
    deleteChildConfirm: string
    deleteMember: string
    deleteMemberConfirm: string
    calendarSyncHint: string
    calendarSyncDesc: string
    // Additional profile strings
    noAllergies: string
    addAllergy: string
    noRegistered: string
    householdAdminBadge: string
    allergyPlaceholder: string
    shortNamePlaceholder: string
    workEmailPlaceholder: string
    tryReloadPage: string
    // AI privacy settings
    shareNamesWithAi: string
    shareNamesEnabled: string
    shareNamesDisabled: string
    // Family calendar settings
    familyCalendar: string
    familyCalendarUrl: string
    familyCalendarHint: string
    lastSynced: string
    noEventsInCalendar: string
  }

  // Recipes page
  recipes: {
    title: string
    addRecipe: string
    editRecipe: string
    searchPlaceholder: string
    noRecipes: string
    noRecipesDesc: string
    recipeName: string
    ingredients: string
    ingredientsPlaceholder: string
    instructions: string
    instructionsPlaceholder: string
    isFavorite: string
    isQuick: string
    isKidFriendly: string
    deleteRecipe: string
    deleteRecipeConfirm: string
    portions: string
    cookingTime: string
    minutes: string
    // Section headers and badges
    favorites: string
    allRecipes: string
    quick: string // Short badge
    kidFriendly: string // Short badge
    noRecipesFound: string
    ingredientsHeader: string // Uppercase section header
  }

  // Shopping list page
  shopping: {
    title: string
    addItem: string
    itemPlaceholder: string
    emptyList: string
    emptyListDesc: string
    clearChecked: string
    clearAll: string
    clearAllConfirm: string
    quantity: string // Short "Qty"
    groceries: string // List name
    otherStores: string // List name
    // View modes
    viewMode: string
    newestFirst: string
    byCategory: string
    // Filters
    filterAll: string
    filterGroceries: string
    filterHome: string
    filterOther: string
    // Duplicate prevention
    alreadyOnList: string
    changeQuantity: string
    // Undo
    itemRemoved: string
    undo: string
    deleteFailedRetrying: string
    // Accessibility
    markAsBought: string
    markAsNotBought: string
    deleteItemLabel: string
    // Suggestions
    suggestions: string
    basedOnMeals: string
    planMealsForSuggestions: string
    aisles: {
      produce: string
      dairy: string
      meat: string
      frozen: string
      pantry: string
      beverages: string
      household: string
      home: string
      electronics: string
      other: string
    }
  }

  // Feed page
  feed: {
    title: string
    subtitle: string
    filters: {
      all: string
      photos: string
      reminders: string
    }
    emptyState: string
    emptyStateDesc: string
    syncButton: string
    syncing: string
    // Smart search
    askPlaceholder: string
    askPlaceholderShort: string
    askButton: string
    asking: string
    answerTitle: string
    sourceTitle: string
    sourceFrom: string
    noRelevantInfo: string
    clearAnswer: string
    tryAgain: string
  }

  // Admin page
  admin: {
    title: string
    allowedEmails: string
    addEmail: string
    emailPlaceholder: string
    canCreateHousehold: string
    isAdmin: string
    appSettings: string
    aiModel: string
    households: string
    noHouseholds: string
    auditLog: string
    showAuditLog: string
    hideAuditLog: string
    calendar: string
    calendarConnected: string
    calendarNotConnected: string
    connectCalendar: string
    syncCalendar: string
    syncing: string
    lastSync: string
    syncedEvents: string
    deleteEmail: string
    deleteEmailConfirm: string
    // Extended admin
    userAccessDesc: string
    addUser: string
    canCreateOwn: string
    becomesHouseholdAdmin: string
    email: string
    action: string
    unnamed: string
    usersAddedViaSettings: string
    householdsOverview: string
    householdsDesc: string
    noHouseholdsYet: string
    membersCount: string
    childrenCount: string
    householdsManageViaSettings: string
    latestChanges: string
    noActivityYet: string
    actionCreated: string
    actionUpdated: string
    actionDeleted: string
    entityPickup: string
    entityMeal: string
    entityChild: string
    entityMember: string
    entityHousehold: string
    entityRecipe: string
    newEntry: string
    deletedEntry: string
    aiSettings: string
    aiSettingsDesc: string
    systemConfigTitle: string
    systemConfigDesc: string
    openrouterModel: string
    visionModel: string
    visionModelDescription: string
    priceNote: string
    modelTestHint: string
    calendarDesc: string
    connected: string
    notConnected: string
    syncedEventsCount: string
    connectGoogleCalendar: string
    syncNow: string
    reconnect: string
    calendarAutoMatchDesc: string
    security: string
    securityDesc: string
    loadingModels: string
    selectModel: string
    searchModels: string
    noModelsFound: string
    syncSuccess: string
    emailExists: string
    userAddedCanCreate: string
    userAdded: string
    cannotDeleteAdmin: string
    modelUpdated: string
    appAdmin: string
    householdAdmin: string
    // Unmatched calendar invites
    unmatchedInvites: string
    unmatchedInvitesDesc: string
    emailMaskedForPrivacy: string
    expiresIn: string
    expiringToday: string
    assign: string
    eventAssigned: string
  }

  // New household wizard
  wizard: {
    welcome: string
    welcomeSubtitle: string
    householdName: string
    householdNamePlaceholder: string
    yourName: string
    yourNamePlaceholder: string
    yourBirthDate: string
    yourAllergies: string
    allergiesPlaceholder: string
    allergiesHint: string
    addChildren: string
    addChildrenSubtitle: string
    childNamePlaceholder: string
    invitePartner: string
    invitePartnerSubtitle: string
    partnerName: string
    partnerNamePlaceholder: string
    partnerEmail: string
    partnerEmailPlaceholder: string
    partnerEmailHint: string
    allDone: string
    allDoneSubtitle: string
    goToWeekPlan: string
    waitingForInvite: string
    waitingForInviteDesc: string
    backToHome: string
    // Extended wizard
    yearsOld: string
    locationName: string
    locationNamePlaceholder: string
    loginEmail: string
    loginEmailHint: string
  }

  // Errors
  errors: {
    generic: string
    notFound: string
    unauthorized: string
    forbidden: string
    networkError: string
    loadFailed: string
    saveFailed: string
    deleteFailed: string
    invalidInput: string
    // Specific errors
    couldNotLoadHousehold: string
    couldNotLoadMembers: string
    couldNotLoadChildren: string
    couldNotLoadPickups: string
    couldNotLoadMeals: string
    couldNotLoadRecipes: string
    couldNotLoadEvents: string
    couldNotLoadTasks: string
    couldNotSavePickup: string
    couldNotSaveMeal: string
    couldNotSaveEvent: string
    couldNotSaveTask: string
    couldNotCreateHousehold: string
    couldNotAddMember: string
    couldNotAddChild: string
    aiSuggestionFailed: string
    calendarSyncFailed: string
    invalidUrl: string
  }

  // Success messages
  success: {
    saved: string
    deleted: string
    copied: string
    cleared: string
    emailAdded: string
    memberAdded: string
    childAdded: string
    recipeAdded: string
    calendarSynced: string
    syncedEvents: string
  }

  // Remember page (Huskeliste)
  remember: {
    title: string
    subtitle: string
    remindersTab: string
    wishlistsTab: string
    todayReminders: string
    weekReminders: string
    laterReminders: string
    recurringReminders: string
    addReminder: string
    editReminder: string
    reminderTitle: string
    reminderDate: string
    reminderTime: string
    reminderNotes: string
    reminderCategory: string
    reminderPriority: string
    assignTo: string
    unassigned: string
    snooze: string
    snoozeUntil: string
    // Categories
    categories: {
      bill: string
      insurance: string
      car: string
      home: string
      health: string
      subscription: string
      other: string
    }
    // Priority
    priorities: {
      low: string
      normal: string
      high: string
    }
    // Task types (extended)
    taskTypes: {
      bring: string
      appointment: string
      reminder: string
      activity: string
      closure: string
      other: string
    }
    // Recurrence
    recurring: string
    recurrencePattern: string
    daily: string
    weekly: string
    biweekly: string
    monthly: string
    yearly: string
    repeatOn: string
    repeatEvery: string
    until: string
    // Status
    open: string
    done: string
    snoozed: string
    overdue: string
    upcoming: string
    today: string
    thisWeek: string
    later: string
    // AI
    aiInput: string
    aiInputPlaceholder: string
    aiParsing: string
    aiConfirm: string
    aiEdit: string
    aiConfidence: string
    aiConfidenceHigh: string
    aiConfidenceMedium: string
    aiConfidenceLow: string
    useThis: string
    // Empty states
    noReminders: string
    noRemindersDesc: string
    addFirstReminder: string
  }

  // Wishlists
  wishlists: {
    title: string
    sectionTitle: string
    sectionDesc: string
    // Occasions
    occasions: {
      birthday: string
      christmas: string
      general: string
    }
    // Items
    addItem: string
    editItem: string
    deleteItem: string
    deleteItemConfirm: string
    itemName: string
    itemDescription: string
    itemLink: string
    itemLinkPlaceholder: string
    itemPrice: string
    itemPriority: string
    priorityStars: string
    // Image upload
    addImage: string
    changeImage: string
    removeImage: string
    uploadImage: string
    analyzing: string
    analyzeImage: string
    imageAnalyzed: string
    // Status
    open: string
    reserve: string
    unreserve: string
    markBought: string
    reserved: string
    reservedBy: string
    bought: string
    boughtBy: string
    enterYourName: string
    // Share link
    shareLink: string
    shareLinkDesc: string
    copyLink: string
    linkCopied: string
    createShareLink: string
    deleteShareLink: string
    externalReservation: string
    // Empty states
    noItems: string
    noItemsDesc: string
    addFirstItem: string
    // Counts
    items: string
    item: string
    // Priority
    noPriority: string
    lowPriority: string
    mediumPriority: string
    highPriority: string
    veryHighPriority: string
    mustHave: string
    // Error messages
    imageReadError: string
    imageUploadFailed: string
    saveFailed: string
    aiNotConfigured: string
    aiAnalysisFailed: string
    loadError: string
    shareLinkError: string
    deleteShareLinkError: string
    copyLinkManually: string
    deleteItemError: string
  }

  // Universal AI Input
  ai: {
    inputPlaceholder: string
    add: string
    change: string
    delete: string
    complete: string
    added: string
    changed: string
    edit: string
    edited: string
    deleted: string
    completed: string
    undo: string
    parsing: string
    confirmDelete: string
    // Image category selection
    whatIsThis: string
    categoryGift: string
    categoryEvent: string
    categoryTask: string
    categoryOther: string
    changeCategory: string
  }

  // Push Notifications
  notifications: {
    title: string
    description: string
    enable: string
    disable: string
    enabled: string
    disabled: string
    unsupported: string
    unsupportedDesc: string
    denied: string
    deniedDesc: string
    preferences: string
    preferencesDesc: string
    pickupAssigned: string
    pickupAssignedDesc: string
    mealChanged: string
    mealChangedDesc: string
    taskAdded: string
    taskAddedDesc: string
    eventAffectsMe: string
    eventAffectsMeDesc: string
    testNotification: string
    testSent: string
  }

  // Install / Add to home screen
  install: {
    title: string
    description: string
    install: string
    installed: string
    installedDesc: string
    howTo: string
    iosStep1: string
    iosStep1b: string
    iosStep2: string
    iosStep3: string
    androidStep1: string
    androidStep2: string
  }

  // App update
  update: {
    available: string
    description: string
    refresh: string
    later: string
  }

  // Legal pages
  legal: {
    privacyPolicy: string
    termsOfService: string
    lastUpdated: string
    acceptTerms: string
    iAccept: string  // "I accept the" prefix for checkbox
    // Privacy policy sections
    whoRunsTitle: string
    whoRunsContent: string
    noGuaranteesTitle: string
    noGuaranteesContent: string
    dataCollectedTitle: string
    dataAccountLabel: string
    dataAccountDesc: string
    dataFamilyLabel: string
    dataFamilyDesc: string
    dataIntegrationsLabel: string
    dataIntegrationsDesc: string
    dataPhotosLabel: string
    dataPhotosDesc: string
    dataStorageTitle: string
    storageDatabase: string
    storageHosting: string
    storageAI: string
    storageAINote: string
    accessTitle: string
    accessContent: string
    rightsTitle: string
    rightsAccessLabel: string
    rightsAccessDesc: string
    rightsDeletionLabel: string
    rightsDeletionDesc: string
    rightsExportLabel: string
    rightsExportDesc: string
    cookiesTitle: string
    cookiesContent: string
    contactTitle: string
    contactContent: string
    // Terms of service sections
    termsAcceptanceTitle: string
    termsAcceptanceContent: string
    termsServiceTitle: string
    termsServiceContent: string
    termsNoGuaranteesTitle: string
    termsNoGuaranteesContent: string
    termsResponsibilityTitle: string
    termsResponsibility1: string
    termsResponsibility2: string
    termsResponsibility3: string
    termsContentTitle: string
    termsContentContent: string
    termsTerminationTitle: string
    termsTerminationContent: string
    termsChangesTitle: string
    termsChangesContent: string
  }

  // Signup flow
  signup: {
    getStarted: string
    wasInvited: string
    wasInvitedDesc: string
    checkInvite: string
    createNew: string
    createNewDesc: string
    dontCreateIfPartner: string
  }

  // Account management
  account: {
    title: string
    deleteAccount: string
    deleteAccountDesc: string
    deleteAccountWarning1: string
    deleteAccountWarning2: string
    deleteAccountWarning3: string
    deleteAccountConfirm: string
    deleteAccountButton: string
    accountDeleted: string
  }

  // Source URLs (manual calendar sources)
  sourceUrls: {
    title: string
    description: string
    addNew: string
    urlLabel: string
    nameLabel: string
    typeLabel: string
    typeCalendarPage: string
    typePdf: string
    typeIcs: string
    childLabel: string
    addButton: string
    syncing: string
    lastSync: string
    syncNow: string
    syncSuccess: string
    eventsFound: string
    invalidUrl: string
    urlExists: string
    remove: string
    removeConfirm: string
  }
}
