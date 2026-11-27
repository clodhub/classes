// Results of the source's own slot functions, run on the inputs below by a copy of that code outside the package.
// Generated; do not edit.
export const slotCases = [
  {
    "name": "an empty regular Tuesday, 60 minutes, buffer 10",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "11:00",
        "end": "12:00"
      },
      {
        "start": "11:30",
        "end": "12:30"
      },
      {
        "start": "12:00",
        "end": "13:00"
      },
      {
        "start": "12:30",
        "end": "13:30"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "one booking mid-morning",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T10:00:00Z",
        "end": "2026-03-03T11:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "12:10",
        "end": "13:10"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "the same booking with the home-visit buffer of 30",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 30,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T10:00:00Z",
        "end": "2026-03-03T11:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "12:30",
        "end": "13:30"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "overlapping bookings out of order, and blocks missing a start or an end",
    "date": "2026-03-03",
    "durationMinutes": 45,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T17:00:00Z",
        "end": "2026-03-03T17:30:00Z"
      },
      {
        "start": "2026-03-03T09:30:00Z",
        "end": null
      },
      {
        "start": "2026-03-03T11:00:00Z",
        "end": "2026-03-03T12:00:00Z"
      },
      {
        "start": "2026-03-03T11:30:00Z",
        "end": "2026-03-03T12:15:00Z"
      },
      {
        "end": "2026-03-03T16:30:00Z"
      },
      {
        "start": "2026-03-03T08:30:00Z",
        "end": "2026-03-03T09:15:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "10:25",
        "end": "11:10"
      },
      {
        "start": "10:55",
        "end": "11:40"
      },
      {
        "start": "16:00",
        "end": "16:45"
      },
      {
        "start": "16:30",
        "end": "17:15"
      },
      {
        "start": "17:00",
        "end": "17:45"
      },
      {
        "start": "18:40",
        "end": "19:25"
      }
    ]
  },
  {
    "name": "a booking across the midday break",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T12:00:00Z",
        "end": "2026-03-03T15:30:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "11:00",
        "end": "12:00"
      },
      {
        "start": "11:30",
        "end": "12:30"
      },
      {
        "start": "16:40",
        "end": "17:40"
      },
      {
        "start": "17:10",
        "end": "18:10"
      },
      {
        "start": "17:40",
        "end": "18:40"
      },
      {
        "start": "18:10",
        "end": "19:10"
      }
    ]
  },
  {
    "name": "a booking ending five minutes before the afternoon opens",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T14:00:00Z",
        "end": "2026-03-03T14:55:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "11:00",
        "end": "12:00"
      },
      {
        "start": "11:30",
        "end": "12:30"
      },
      {
        "start": "12:00",
        "end": "13:00"
      },
      {
        "start": "12:30",
        "end": "13:30"
      },
      {
        "start": "16:05",
        "end": "17:05"
      },
      {
        "start": "16:35",
        "end": "17:35"
      },
      {
        "start": "17:05",
        "end": "18:05"
      },
      {
        "start": "17:35",
        "end": "18:35"
      },
      {
        "start": "18:05",
        "end": "19:05"
      }
    ]
  },
  {
    "name": "a booking ending five minutes before the morning opens",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T07:30:00Z",
        "end": "2026-03-03T08:25:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:35",
        "end": "10:35"
      },
      {
        "start": "10:05",
        "end": "11:05"
      },
      {
        "start": "10:35",
        "end": "11:35"
      },
      {
        "start": "11:05",
        "end": "12:05"
      },
      {
        "start": "11:35",
        "end": "12:35"
      },
      {
        "start": "12:05",
        "end": "13:05"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "a booking at the opening",
    "date": "2026-03-03",
    "durationMinutes": 30,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T08:30:00Z",
        "end": "2026-03-03T09:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "10:10",
        "end": "10:40"
      },
      {
        "start": "10:40",
        "end": "11:10"
      },
      {
        "start": "11:10",
        "end": "11:40"
      },
      {
        "start": "11:40",
        "end": "12:10"
      },
      {
        "start": "12:10",
        "end": "12:40"
      },
      {
        "start": "12:40",
        "end": "13:10"
      },
      {
        "start": "16:00",
        "end": "16:30"
      },
      {
        "start": "16:30",
        "end": "17:00"
      },
      {
        "start": "17:00",
        "end": "17:30"
      },
      {
        "start": "17:30",
        "end": "18:00"
      },
      {
        "start": "18:00",
        "end": "18:30"
      },
      {
        "start": "18:30",
        "end": "19:00"
      },
      {
        "start": "19:00",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "a block whose end plus the buffer meets the cursor",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T08:00:00Z",
        "end": "2026-03-03T08:20:00Z"
      },
      {
        "start": "2026-03-03T11:00:00Z",
        "end": "2026-03-03T12:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "a block starting exactly when a slot and its buffer end",
    "date": "2026-03-03",
    "durationMinutes": 50,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T09:30:00Z",
        "end": "2026-03-03T10:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:20"
      },
      {
        "start": "11:10",
        "end": "12:00"
      },
      {
        "start": "11:40",
        "end": "12:30"
      },
      {
        "start": "12:10",
        "end": "13:00"
      },
      {
        "start": "12:40",
        "end": "13:30"
      },
      {
        "start": "16:00",
        "end": "16:50"
      },
      {
        "start": "16:30",
        "end": "17:20"
      },
      {
        "start": "17:00",
        "end": "17:50"
      },
      {
        "start": "17:30",
        "end": "18:20"
      },
      {
        "start": "18:00",
        "end": "18:50"
      },
      {
        "start": "18:30",
        "end": "19:20"
      }
    ]
  },
  {
    "name": "a treatment longer than any window",
    "date": "2026-03-03",
    "durationMinutes": 330,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": []
  },
  {
    "name": "a quiet Wednesday, 90 minutes, several bookings",
    "date": "2026-03-04",
    "durationMinutes": 90,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "08:30",
        "close": "16:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-04T08:45:00Z",
        "end": "2026-03-04T09:30:00Z"
      },
      {
        "start": "2026-03-04T11:00:00Z",
        "end": "2026-03-04T12:30:00Z"
      },
      {
        "start": "2026-03-04T14:30:00Z",
        "end": "2026-03-04T16:30:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-04T08:30:00+01:00",
      "timeMax": "2026-03-04T16:30:00+01:00"
    },
    "slots": [
      {
        "start": "13:40",
        "end": "15:10"
      }
    ]
  },
  {
    "name": "a fully booked Saturday",
    "date": "2026-03-07",
    "durationMinutes": 45,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:00",
        "close": "14:00"
      }
    ],
    "busy": [
      {
        "start": "2026-03-07T07:30:00Z",
        "end": "2026-03-07T14:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-07T09:00:00+01:00",
      "timeMax": "2026-03-07T14:00:00+01:00"
    },
    "slots": []
  },
  {
    "name": "a 15-minute treatment on a Saturday with one booking",
    "date": "2026-03-07",
    "durationMinutes": 15,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:00",
        "close": "14:00"
      }
    ],
    "busy": [
      {
        "start": "2026-03-07T10:05:00Z",
        "end": "2026-03-07T10:20:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-07T09:00:00+01:00",
      "timeMax": "2026-03-07T14:00:00+01:00"
    },
    "slots": [
      {
        "start": "09:00",
        "end": "09:15"
      },
      {
        "start": "09:30",
        "end": "09:45"
      },
      {
        "start": "10:00",
        "end": "10:15"
      },
      {
        "start": "10:30",
        "end": "10:45"
      },
      {
        "start": "11:30",
        "end": "11:45"
      },
      {
        "start": "12:00",
        "end": "12:15"
      },
      {
        "start": "12:30",
        "end": "12:45"
      },
      {
        "start": "13:00",
        "end": "13:15"
      },
      {
        "start": "13:30",
        "end": "13:45"
      }
    ]
  },
  {
    "name": "a summer Tuesday on summer time",
    "date": "2026-07-07",
    "durationMinutes": 75,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-07-07T08:45:00Z",
        "end": "2026-07-07T09:30:00Z"
      },
      {
        "start": "2026-07-07T15:00:00Z",
        "end": "2026-07-07T15:40:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-07-07T09:30:00+02:00",
      "timeMax": "2026-07-07T19:30:00+02:00"
    },
    "slots": [
      {
        "start": "11:40",
        "end": "12:55"
      },
      {
        "start": "12:10",
        "end": "13:25"
      },
      {
        "start": "17:50",
        "end": "19:05"
      }
    ]
  },
  {
    "name": "busy blocks written with an offset instead of Z",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T12:00:00+01:00",
        "end": "2026-03-03T13:20:00+01:00"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      },
      {
        "start": "18:00",
        "end": "19:00"
      },
      {
        "start": "18:30",
        "end": "19:30"
      }
    ]
  },
  {
    "name": "a booking running past the day's last window",
    "date": "2026-03-03",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:30",
        "close": "13:30"
      },
      {
        "open": "16:00",
        "close": "19:30"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T18:00:00Z",
        "end": "2026-03-03T20:00:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T09:30:00+01:00",
      "timeMax": "2026-03-03T19:30:00+01:00"
    },
    "slots": [
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      },
      {
        "start": "11:00",
        "end": "12:00"
      },
      {
        "start": "11:30",
        "end": "12:30"
      },
      {
        "start": "12:00",
        "end": "13:00"
      },
      {
        "start": "12:30",
        "end": "13:30"
      },
      {
        "start": "16:00",
        "end": "17:00"
      },
      {
        "start": "16:30",
        "end": "17:30"
      },
      {
        "start": "17:00",
        "end": "18:00"
      },
      {
        "start": "17:30",
        "end": "18:30"
      }
    ]
  },
  {
    "name": "a closed Sunday",
    "date": "2026-03-01",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [],
    "busy": [],
    "range": null,
    "slots": []
  },
  {
    "name": "a closed Monday",
    "date": "2026-03-02",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [],
    "busy": [],
    "range": null,
    "slots": []
  },
  {
    "name": "the spring-forward Sunday with a Sunday window",
    "date": "2026-03-29",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:00",
        "close": "13:00"
      }
    ],
    "busy": [
      {
        "start": "2026-03-29T09:00:00Z",
        "end": "2026-03-29T09:30:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-29T09:00:00+02:00",
      "timeMax": "2026-03-29T13:00:00+02:00"
    },
    "slots": [
      {
        "start": "09:00",
        "end": "10:00"
      },
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "11:40",
        "end": "12:40"
      }
    ]
  },
  {
    "name": "the fall-back Sunday with a Sunday window",
    "date": "2026-10-25",
    "durationMinutes": 60,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "09:00",
        "close": "13:00"
      }
    ],
    "busy": [
      {
        "start": "2026-10-25T11:00:00Z",
        "end": "2026-10-25T11:45:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-10-25T09:00:00+01:00",
      "timeMax": "2026-10-25T13:00:00+01:00"
    },
    "slots": [
      {
        "start": "09:00",
        "end": "10:00"
      },
      {
        "start": "09:30",
        "end": "10:30"
      },
      {
        "start": "10:00",
        "end": "11:00"
      },
      {
        "start": "10:30",
        "end": "11:30"
      }
    ]
  },
  {
    "name": "a window closing at midnight",
    "date": "2026-03-03",
    "durationMinutes": 120,
    "bufferMinutes": 10,
    "windows": [
      {
        "open": "20:30",
        "close": "24:00"
      }
    ],
    "busy": [
      {
        "start": "2026-03-03T20:00:00Z",
        "end": "2026-03-03T20:30:00Z"
      }
    ],
    "range": {
      "timeMin": "2026-03-03T20:30:00+01:00",
      "timeMax": "2026-03-03T24:00:00+01:00"
    },
    "slots": [
      {
        "start": "21:40",
        "end": "23:40"
      }
    ]
  }
];

export const intervalCases = [
  {
    "name": "a booking at the studio",
    "date": "2026-03-03",
    "startTime": "10:00",
    "durationMinutes": 60,
    "start": "2026-03-03T09:00:00.000Z",
    "end": "2026-03-03T10:00:00.000Z"
  },
  {
    "name": "a home visit with the 30-minute buffer is widened on both sides",
    "date": "2026-03-03",
    "startTime": "10:00",
    "durationMinutes": 60,
    "bufferMinutes": 30,
    "isHomeVisit": true,
    "start": "2026-03-03T08:30:00.000Z",
    "end": "2026-03-03T10:30:00.000Z"
  },
  {
    "name": "a home visit with the default buffer is not widened",
    "date": "2026-03-03",
    "startTime": "17:30",
    "durationMinutes": 90,
    "isHomeVisit": true,
    "start": "2026-03-03T16:30:00.000Z",
    "end": "2026-03-03T18:00:00.000Z"
  },
  {
    "name": "a booking at the studio with a buffer of 30 is not widened",
    "date": "2026-03-03",
    "startTime": "12:00",
    "durationMinutes": 45,
    "bufferMinutes": 30,
    "isHomeVisit": false,
    "start": "2026-03-03T11:00:00.000Z",
    "end": "2026-03-03T11:45:00.000Z"
  },
  {
    "name": "a summer booking of three treatments",
    "date": "2026-07-07",
    "startTime": "17:05",
    "durationMinutes": 125,
    "start": "2026-07-07T15:05:00.000Z",
    "end": "2026-07-07T17:10:00.000Z"
  },
  {
    "name": "a summer home visit",
    "date": "2026-07-07",
    "startTime": "10:00",
    "durationMinutes": 60,
    "bufferMinutes": 30,
    "isHomeVisit": true,
    "start": "2026-07-07T07:30:00.000Z",
    "end": "2026-07-07T09:30:00.000Z"
  }
];

export const overlapBusy = [
  {
    "start": "2026-03-03T10:00:00Z",
    "end": "2026-03-03T11:00:00Z"
  },
  {
    "start": "2026-03-03T12:00:00Z",
    "end": null
  },
  {
    "start": "2026-03-03T16:00:00Z",
    "end": "2026-03-03T16:30:00Z"
  }
];

export const overlapCases = [
  {
    "start": "2026-03-03T09:00:00Z",
    "end": "2026-03-03T10:00:00Z",
    "overlaps": false
  },
  {
    "start": "2026-03-03T09:00:00Z",
    "end": "2026-03-03T10:01:00Z",
    "overlaps": true
  },
  {
    "start": "2026-03-03T11:00:00Z",
    "end": "2026-03-03T12:00:00Z",
    "overlaps": false
  },
  {
    "start": "2026-03-03T10:59:00Z",
    "end": "2026-03-03T11:30:00Z",
    "overlaps": true
  },
  {
    "start": "2026-03-03T12:00:00Z",
    "end": "2026-03-03T13:00:00Z",
    "overlaps": false
  },
  {
    "start": "2026-03-03T15:30:00Z",
    "end": "2026-03-03T16:00:00Z",
    "overlaps": false
  },
  {
    "start": "2026-03-03T15:30:00Z",
    "end": "2026-03-03T16:45:00Z",
    "overlaps": true
  },
  {
    "start": "2026-03-03T16:10:00Z",
    "end": "2026-03-03T16:20:00Z",
    "overlaps": true
  }
];
