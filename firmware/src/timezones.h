// Generated from work_data/timezones.json; run scripts/prepare_timezones.py.
#pragma once
#include <cstring>
#include <cstdint>
#include <cstdio>
#ifdef ARDUINO
#include <pgmspace.h>
#define ALARM_TZ_FLASH PROGMEM
#else
#define ALARM_TZ_FLASH
#endif
namespace alarmTimeZones {
constexpr char DEFAULT_ID[] = "Europe/Kyiv";
inline char readByte(const char *p) {
#ifdef ARDUINO
    return pgm_read_byte(p);
#else
    return *p;
#endif
}
inline const char *ruleFor(const char *id) {
    static const char ZONES[] ALARM_TZ_FLASH =
    "Africa/Abidjan\0" "GMT0\0"
    "Africa/Accra\0" "GMT0\0"
    "Africa/Addis_Ababa\0" "EAT-3\0"
    "Africa/Algiers\0" "CET-1\0"
    "Africa/Asmara\0" "EAT-3\0"
    "Africa/Asmera\0" "EAT-3\0"
    "Africa/Bamako\0" "GMT0\0"
    "Africa/Bangui\0" "WAT-1\0"
    "Africa/Banjul\0" "GMT0\0"
    "Africa/Bissau\0" "GMT0\0"
    "Africa/Blantyre\0" "CAT-2\0"
    "Africa/Brazzaville\0" "WAT-1\0"
    "Africa/Bujumbura\0" "CAT-2\0"
    "Africa/Cairo\0" "EET-2EEST,M4.5.5/0,M10.5.4/24\0"
    "Africa/Casablanca\0" "<+00>0\0"
    "Africa/Ceuta\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Africa/Conakry\0" "GMT0\0"
    "Africa/Dakar\0" "GMT0\0"
    "Africa/Dar_es_Salaam\0" "EAT-3\0"
    "Africa/Djibouti\0" "EAT-3\0"
    "Africa/Douala\0" "WAT-1\0"
    "Africa/El_Aaiun\0" "<+00>0\0"
    "Africa/Freetown\0" "GMT0\0"
    "Africa/Gaborone\0" "CAT-2\0"
    "Africa/Harare\0" "CAT-2\0"
    "Africa/Johannesburg\0" "SAST-2\0"
    "Africa/Juba\0" "CAT-2\0"
    "Africa/Kampala\0" "EAT-3\0"
    "Africa/Khartoum\0" "CAT-2\0"
    "Africa/Kigali\0" "CAT-2\0"
    "Africa/Kinshasa\0" "WAT-1\0"
    "Africa/Lagos\0" "WAT-1\0"
    "Africa/Libreville\0" "WAT-1\0"
    "Africa/Lome\0" "GMT0\0"
    "Africa/Luanda\0" "WAT-1\0"
    "Africa/Lubumbashi\0" "CAT-2\0"
    "Africa/Lusaka\0" "CAT-2\0"
    "Africa/Malabo\0" "WAT-1\0"
    "Africa/Maputo\0" "CAT-2\0"
    "Africa/Maseru\0" "SAST-2\0"
    "Africa/Mbabane\0" "SAST-2\0"
    "Africa/Mogadishu\0" "EAT-3\0"
    "Africa/Monrovia\0" "GMT0\0"
    "Africa/Nairobi\0" "EAT-3\0"
    "Africa/Ndjamena\0" "WAT-1\0"
    "Africa/Niamey\0" "WAT-1\0"
    "Africa/Nouakchott\0" "GMT0\0"
    "Africa/Ouagadougou\0" "GMT0\0"
    "Africa/Porto-Novo\0" "WAT-1\0"
    "Africa/Sao_Tome\0" "GMT0\0"
    "Africa/Timbuktu\0" "GMT0\0"
    "Africa/Tripoli\0" "EET-2\0"
    "Africa/Tunis\0" "CET-1\0"
    "Africa/Windhoek\0" "CAT-2\0"
    "America/Adak\0" "HST10HDT,M3.2.0,M11.1.0\0"
    "America/Anchorage\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/Anguilla\0" "AST4\0"
    "America/Antigua\0" "AST4\0"
    "America/Araguaina\0" "<-03>3\0"
    "America/Argentina/Buenos_Aires\0" "<-03>3\0"
    "America/Argentina/Catamarca\0" "<-03>3\0"
    "America/Argentina/ComodRivadavia\0" "<-03>3\0"
    "America/Argentina/Cordoba\0" "<-03>3\0"
    "America/Argentina/Jujuy\0" "<-03>3\0"
    "America/Argentina/La_Rioja\0" "<-03>3\0"
    "America/Argentina/Mendoza\0" "<-03>3\0"
    "America/Argentina/Rio_Gallegos\0" "<-03>3\0"
    "America/Argentina/Salta\0" "<-03>3\0"
    "America/Argentina/San_Juan\0" "<-03>3\0"
    "America/Argentina/San_Luis\0" "<-03>3\0"
    "America/Argentina/Tucuman\0" "<-03>3\0"
    "America/Argentina/Ushuaia\0" "<-03>3\0"
    "America/Aruba\0" "AST4\0"
    "America/Asuncion\0" "<-03>3\0"
    "America/Atikokan\0" "EST5\0"
    "America/Atka\0" "HST10HDT,M3.2.0,M11.1.0\0"
    "America/Bahia\0" "<-03>3\0"
    "America/Bahia_Banderas\0" "CST6\0"
    "America/Barbados\0" "AST4\0"
    "America/Belem\0" "<-03>3\0"
    "America/Belize\0" "CST6\0"
    "America/Blanc-Sablon\0" "AST4\0"
    "America/Boa_Vista\0" "<-04>4\0"
    "America/Bogota\0" "<-05>5\0"
    "America/Boise\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "America/Buenos_Aires\0" "<-03>3\0"
    "America/Cambridge_Bay\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "America/Campo_Grande\0" "<-04>4\0"
    "America/Cancun\0" "EST5\0"
    "America/Caracas\0" "<-04>4\0"
    "America/Catamarca\0" "<-03>3\0"
    "America/Cayenne\0" "<-03>3\0"
    "America/Cayman\0" "EST5\0"
    "America/Chicago\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Chihuahua\0" "CST6\0"
    "America/Ciudad_Juarez\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "America/Coral_Harbour\0" "EST5\0"
    "America/Cordoba\0" "<-03>3\0"
    "America/Costa_Rica\0" "CST6\0"
    "America/Coyhaique\0" "<-03>3\0"
    "America/Creston\0" "MST7\0"
    "America/Cuiaba\0" "<-04>4\0"
    "America/Curacao\0" "AST4\0"
    "America/Danmarkshavn\0" "GMT0\0"
    "America/Dawson\0" "MST7\0"
    "America/Dawson_Creek\0" "MST7\0"
    "America/Denver\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "America/Detroit\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Dominica\0" "AST4\0"
    "America/Edmonton\0" "CST6\0"
    "America/Eirunepe\0" "<-05>5\0"
    "America/El_Salvador\0" "CST6\0"
    "America/Ensenada\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "America/Fort_Nelson\0" "MST7\0"
    "America/Fort_Wayne\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Fortaleza\0" "<-03>3\0"
    "America/Glace_Bay\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "America/Godthab\0" "<-02>2<-01>,M3.5.0/-1,M10.5.0/0\0"
    "America/Goose_Bay\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "America/Grand_Turk\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Grenada\0" "AST4\0"
    "America/Guadeloupe\0" "AST4\0"
    "America/Guatemala\0" "CST6\0"
    "America/Guayaquil\0" "<-05>5\0"
    "America/Guyana\0" "<-04>4\0"
    "America/Halifax\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "America/Havana\0" "CST5CDT,M3.2.0/0,M11.1.0/1\0"
    "America/Hermosillo\0" "MST7\0"
    "America/Indiana/Indianapolis\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Knox\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Marengo\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Petersburg\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Tell_City\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Vevay\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Vincennes\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indiana/Winamac\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Indianapolis\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Inuvik\0" "CST6\0"
    "America/Iqaluit\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Jamaica\0" "EST5\0"
    "America/Jujuy\0" "<-03>3\0"
    "America/Juneau\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/Kentucky/Louisville\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Kentucky/Monticello\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Knox_IN\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Kralendijk\0" "AST4\0"
    "America/La_Paz\0" "<-04>4\0"
    "America/Lima\0" "<-05>5\0"
    "America/Los_Angeles\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "America/Louisville\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Lower_Princes\0" "AST4\0"
    "America/Maceio\0" "<-03>3\0"
    "America/Managua\0" "CST6\0"
    "America/Manaus\0" "<-04>4\0"
    "America/Marigot\0" "AST4\0"
    "America/Martinique\0" "AST4\0"
    "America/Matamoros\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Mazatlan\0" "MST7\0"
    "America/Mendoza\0" "<-03>3\0"
    "America/Menominee\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Merida\0" "CST6\0"
    "America/Metlakatla\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/Mexico_City\0" "CST6\0"
    "America/Miquelon\0" "<-03>3<-02>,M3.2.0,M11.1.0\0"
    "America/Moncton\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "America/Monterrey\0" "CST6\0"
    "America/Montevideo\0" "<-03>3\0"
    "America/Montreal\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Montserrat\0" "AST4\0"
    "America/Nassau\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/New_York\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Nipigon\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Nome\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/Noronha\0" "<-02>2\0"
    "America/North_Dakota/Beulah\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/North_Dakota/Center\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/North_Dakota/New_Salem\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Nuuk\0" "<-02>2<-01>,M3.5.0/-1,M10.5.0/0\0"
    "America/Ojinaga\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Panama\0" "EST5\0"
    "America/Pangnirtung\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Paramaribo\0" "<-03>3\0"
    "America/Phoenix\0" "MST7\0"
    "America/Port-au-Prince\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Port_of_Spain\0" "AST4\0"
    "America/Porto_Acre\0" "<-05>5\0"
    "America/Porto_Velho\0" "<-04>4\0"
    "America/Puerto_Rico\0" "AST4\0"
    "America/Punta_Arenas\0" "<-03>3\0"
    "America/Rainy_River\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Rankin_Inlet\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Recife\0" "<-03>3\0"
    "America/Regina\0" "CST6\0"
    "America/Resolute\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Rio_Branco\0" "<-05>5\0"
    "America/Rosario\0" "<-03>3\0"
    "America/Santa_Isabel\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "America/Santarem\0" "<-03>3\0"
    "America/Santiago\0" "<-04>4<-03>,M9.1.6/24,M4.1.6/24\0"
    "America/Santo_Domingo\0" "AST4\0"
    "America/Sao_Paulo\0" "<-03>3\0"
    "America/Scoresbysund\0" "<-02>2<-01>,M3.5.0/-1,M10.5.0/0\0"
    "America/Shiprock\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "America/Sitka\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/St_Barthelemy\0" "AST4\0"
    "America/St_Johns\0" "NST3:30NDT,M3.2.0,M11.1.0\0"
    "America/St_Kitts\0" "AST4\0"
    "America/St_Lucia\0" "AST4\0"
    "America/St_Thomas\0" "AST4\0"
    "America/St_Vincent\0" "AST4\0"
    "America/Swift_Current\0" "CST6\0"
    "America/Tegucigalpa\0" "CST6\0"
    "America/Thule\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "America/Thunder_Bay\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Tijuana\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "America/Toronto\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "America/Tortola\0" "AST4\0"
    "America/Vancouver\0" "MST7\0"
    "America/Virgin\0" "AST4\0"
    "America/Whitehorse\0" "MST7\0"
    "America/Winnipeg\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "America/Yakutat\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "America/Yellowknife\0" "CST6\0"
    "Antarctica/Casey\0" "<+08>-8\0"
    "Antarctica/Davis\0" "<+07>-7\0"
    "Antarctica/DumontDUrville\0" "<+10>-10\0"
    "Antarctica/Macquarie\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Antarctica/Mawson\0" "<+05>-5\0"
    "Antarctica/McMurdo\0" "NZST-12NZDT,M9.5.0,M4.1.0/3\0"
    "Antarctica/Palmer\0" "<-03>3\0"
    "Antarctica/Rothera\0" "<-03>3\0"
    "Antarctica/South_Pole\0" "NZST-12NZDT,M9.5.0,M4.1.0/3\0"
    "Antarctica/Syowa\0" "<+03>-3\0"
    "Antarctica/Troll\0" "<+00>0<+02>-2,M3.5.0/1,M10.5.0/3\0"
    "Antarctica/Vostok\0" "<+05>-5\0"
    "Arctic/Longyearbyen\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Asia/Aden\0" "<+03>-3\0"
    "Asia/Almaty\0" "<+05>-5\0"
    "Asia/Amman\0" "<+03>-3\0"
    "Asia/Anadyr\0" "<+12>-12\0"
    "Asia/Aqtau\0" "<+05>-5\0"
    "Asia/Aqtobe\0" "<+05>-5\0"
    "Asia/Ashgabat\0" "<+05>-5\0"
    "Asia/Ashkhabad\0" "<+05>-5\0"
    "Asia/Atyrau\0" "<+05>-5\0"
    "Asia/Baghdad\0" "<+03>-3\0"
    "Asia/Bahrain\0" "<+03>-3\0"
    "Asia/Baku\0" "<+04>-4\0"
    "Asia/Bangkok\0" "<+07>-7\0"
    "Asia/Barnaul\0" "<+07>-7\0"
    "Asia/Beirut\0" "EET-2EEST,M3.5.0/0,M10.5.0/0\0"
    "Asia/Bishkek\0" "<+06>-6\0"
    "Asia/Brunei\0" "<+08>-8\0"
    "Asia/Calcutta\0" "IST-5:30\0"
    "Asia/Chita\0" "<+09>-9\0"
    "Asia/Choibalsan\0" "<+08>-8\0"
    "Asia/Chongqing\0" "CST-8\0"
    "Asia/Chungking\0" "CST-8\0"
    "Asia/Colombo\0" "<+0530>-5:30\0"
    "Asia/Dacca\0" "<+06>-6\0"
    "Asia/Damascus\0" "<+03>-3\0"
    "Asia/Dhaka\0" "<+06>-6\0"
    "Asia/Dili\0" "<+09>-9\0"
    "Asia/Dubai\0" "<+04>-4\0"
    "Asia/Dushanbe\0" "<+05>-5\0"
    "Asia/Famagusta\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Asia/Gaza\0" "EET-2EEST,M3.4.4/50,M10.4.4/50\0"
    "Asia/Harbin\0" "CST-8\0"
    "Asia/Hebron\0" "EET-2EEST,M3.4.4/50,M10.4.4/50\0"
    "Asia/Ho_Chi_Minh\0" "<+07>-7\0"
    "Asia/Hong_Kong\0" "HKT-8\0"
    "Asia/Hovd\0" "<+07>-7\0"
    "Asia/Irkutsk\0" "<+08>-8\0"
    "Asia/Istanbul\0" "<+03>-3\0"
    "Asia/Jakarta\0" "WIB-7\0"
    "Asia/Jayapura\0" "WIT-9\0"
    "Asia/Jerusalem\0" "IST-2IDT,M3.4.4/26,M10.5.0\0"
    "Asia/Kabul\0" "<+0430>-4:30\0"
    "Asia/Kamchatka\0" "<+12>-12\0"
    "Asia/Karachi\0" "PKT-5\0"
    "Asia/Kashgar\0" "<+06>-6\0"
    "Asia/Kathmandu\0" "<+0545>-5:45\0"
    "Asia/Katmandu\0" "<+0545>-5:45\0"
    "Asia/Khandyga\0" "<+09>-9\0"
    "Asia/Kolkata\0" "IST-5:30\0"
    "Asia/Krasnoyarsk\0" "<+07>-7\0"
    "Asia/Kuala_Lumpur\0" "<+08>-8\0"
    "Asia/Kuching\0" "<+08>-8\0"
    "Asia/Kuwait\0" "<+03>-3\0"
    "Asia/Macao\0" "CST-8\0"
    "Asia/Macau\0" "CST-8\0"
    "Asia/Magadan\0" "<+11>-11\0"
    "Asia/Makassar\0" "WITA-8\0"
    "Asia/Manila\0" "PST-8\0"
    "Asia/Muscat\0" "<+04>-4\0"
    "Asia/Nicosia\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Asia/Novokuznetsk\0" "<+07>-7\0"
    "Asia/Novosibirsk\0" "<+07>-7\0"
    "Asia/Omsk\0" "<+06>-6\0"
    "Asia/Oral\0" "<+05>-5\0"
    "Asia/Phnom_Penh\0" "<+07>-7\0"
    "Asia/Pontianak\0" "WIB-7\0"
    "Asia/Pyongyang\0" "KST-9\0"
    "Asia/Qatar\0" "<+03>-3\0"
    "Asia/Qostanay\0" "<+05>-5\0"
    "Asia/Qyzylorda\0" "<+05>-5\0"
    "Asia/Rangoon\0" "<+0630>-6:30\0"
    "Asia/Riyadh\0" "<+03>-3\0"
    "Asia/Saigon\0" "<+07>-7\0"
    "Asia/Sakhalin\0" "<+11>-11\0"
    "Asia/Samarkand\0" "<+05>-5\0"
    "Asia/Seoul\0" "KST-9\0"
    "Asia/Shanghai\0" "CST-8\0"
    "Asia/Singapore\0" "<+08>-8\0"
    "Asia/Srednekolymsk\0" "<+11>-11\0"
    "Asia/Taipei\0" "CST-8\0"
    "Asia/Tashkent\0" "<+05>-5\0"
    "Asia/Tbilisi\0" "<+04>-4\0"
    "Asia/Tehran\0" "<+0330>-3:30\0"
    "Asia/Tel_Aviv\0" "IST-2IDT,M3.4.4/26,M10.5.0\0"
    "Asia/Thimbu\0" "<+06>-6\0"
    "Asia/Thimphu\0" "<+06>-6\0"
    "Asia/Tokyo\0" "JST-9\0"
    "Asia/Tomsk\0" "<+07>-7\0"
    "Asia/Ujung_Pandang\0" "WITA-8\0"
    "Asia/Ulaanbaatar\0" "<+08>-8\0"
    "Asia/Ulan_Bator\0" "<+08>-8\0"
    "Asia/Urumqi\0" "<+06>-6\0"
    "Asia/Ust-Nera\0" "<+10>-10\0"
    "Asia/Vientiane\0" "<+07>-7\0"
    "Asia/Vladivostok\0" "<+10>-10\0"
    "Asia/Yakutsk\0" "<+09>-9\0"
    "Asia/Yangon\0" "<+0630>-6:30\0"
    "Asia/Yekaterinburg\0" "<+05>-5\0"
    "Asia/Yerevan\0" "<+04>-4\0"
    "Atlantic/Azores\0" "<-01>1<+00>,M3.5.0/0,M10.5.0/1\0"
    "Atlantic/Bermuda\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "Atlantic/Canary\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Atlantic/Cape_Verde\0" "<-01>1\0"
    "Atlantic/Faeroe\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Atlantic/Faroe\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Atlantic/Jan_Mayen\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Atlantic/Madeira\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Atlantic/Reykjavik\0" "GMT0\0"
    "Atlantic/South_Georgia\0" "<-02>2\0"
    "Atlantic/St_Helena\0" "GMT0\0"
    "Atlantic/Stanley\0" "<-03>3\0"
    "Australia/ACT\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/Adelaide\0" "ACST-9:30ACDT,M10.1.0,M4.1.0/3\0"
    "Australia/Brisbane\0" "AEST-10\0"
    "Australia/Broken_Hill\0" "ACST-9:30ACDT,M10.1.0,M4.1.0/3\0"
    "Australia/Canberra\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/Currie\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/Darwin\0" "ACST-9:30\0"
    "Australia/Eucla\0" "<+0845>-8:45\0"
    "Australia/Hobart\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/LHI\0" "<+1030>-10:30<+11>-11,M10.1.0,M4.1.0\0"
    "Australia/Lindeman\0" "AEST-10\0"
    "Australia/Lord_Howe\0" "<+1030>-10:30<+11>-11,M10.1.0,M4.1.0\0"
    "Australia/Melbourne\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/NSW\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/North\0" "ACST-9:30\0"
    "Australia/Perth\0" "AWST-8\0"
    "Australia/Queensland\0" "AEST-10\0"
    "Australia/South\0" "ACST-9:30ACDT,M10.1.0,M4.1.0/3\0"
    "Australia/Sydney\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/Tasmania\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/Victoria\0" "AEST-10AEDT,M10.1.0,M4.1.0/3\0"
    "Australia/West\0" "AWST-8\0"
    "Australia/Yancowinna\0" "ACST-9:30ACDT,M10.1.0,M4.1.0/3\0"
    "Brazil/Acre\0" "<-05>5\0"
    "Brazil/DeNoronha\0" "<-02>2\0"
    "Brazil/East\0" "<-03>3\0"
    "Brazil/West\0" "<-04>4\0"
    "CET\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "CST6CDT\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "Canada/Atlantic\0" "AST4ADT,M3.2.0,M11.1.0\0"
    "Canada/Central\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "Canada/Eastern\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "Canada/Mountain\0" "CST6\0"
    "Canada/Newfoundland\0" "NST3:30NDT,M3.2.0,M11.1.0\0"
    "Canada/Pacific\0" "MST7\0"
    "Canada/Saskatchewan\0" "CST6\0"
    "Canada/Yukon\0" "MST7\0"
    "Chile/Continental\0" "<-04>4<-03>,M9.1.6/24,M4.1.6/24\0"
    "Chile/EasterIsland\0" "<-06>6<-05>,M9.1.6/22,M4.1.6/22\0"
    "Cuba\0" "CST5CDT,M3.2.0/0,M11.1.0/1\0"
    "EET\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "EST\0" "EST5\0"
    "EST5EDT\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "Egypt\0" "EET-2EEST,M4.5.5/0,M10.5.4/24\0"
    "Eire\0" "IST-1GMT0,M10.5.0,M3.5.0/1\0"
    "Etc/GMT\0" "GMT0\0"
    "Etc/GMT+0\0" "GMT0\0"
    "Etc/GMT+1\0" "<-01>1\0"
    "Etc/GMT+10\0" "<-10>10\0"
    "Etc/GMT+11\0" "<-11>11\0"
    "Etc/GMT+12\0" "<-12>12\0"
    "Etc/GMT+2\0" "<-02>2\0"
    "Etc/GMT+3\0" "<-03>3\0"
    "Etc/GMT+4\0" "<-04>4\0"
    "Etc/GMT+5\0" "<-05>5\0"
    "Etc/GMT+6\0" "<-06>6\0"
    "Etc/GMT+7\0" "<-07>7\0"
    "Etc/GMT+8\0" "<-08>8\0"
    "Etc/GMT+9\0" "<-09>9\0"
    "Etc/GMT-0\0" "GMT0\0"
    "Etc/GMT-1\0" "<+01>-1\0"
    "Etc/GMT-10\0" "<+10>-10\0"
    "Etc/GMT-11\0" "<+11>-11\0"
    "Etc/GMT-12\0" "<+12>-12\0"
    "Etc/GMT-13\0" "<+13>-13\0"
    "Etc/GMT-14\0" "<+14>-14\0"
    "Etc/GMT-2\0" "<+02>-2\0"
    "Etc/GMT-3\0" "<+03>-3\0"
    "Etc/GMT-4\0" "<+04>-4\0"
    "Etc/GMT-5\0" "<+05>-5\0"
    "Etc/GMT-6\0" "<+06>-6\0"
    "Etc/GMT-7\0" "<+07>-7\0"
    "Etc/GMT-8\0" "<+08>-8\0"
    "Etc/GMT-9\0" "<+09>-9\0"
    "Etc/GMT0\0" "GMT0\0"
    "Etc/Greenwich\0" "GMT0\0"
    "Etc/UCT\0" "UTC0\0"
    "Etc/UTC\0" "UTC0\0"
    "Etc/Universal\0" "UTC0\0"
    "Etc/Zulu\0" "UTC0\0"
    "Europe/Amsterdam\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Andorra\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Astrakhan\0" "<+04>-4\0"
    "Europe/Athens\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Belfast\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "Europe/Belgrade\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Berlin\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Bratislava\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Brussels\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Bucharest\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Budapest\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Busingen\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Chisinau\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Copenhagen\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Dublin\0" "IST-1GMT0,M10.5.0,M3.5.0/1\0"
    "Europe/Gibraltar\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Guernsey\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "Europe/Helsinki\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Isle_of_Man\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "Europe/Istanbul\0" "<+03>-3\0"
    "Europe/Jersey\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "Europe/Kaliningrad\0" "EET-2\0"
    "Europe/Kiev\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Kirov\0" "MSK-3\0"
    "Europe/Kyiv\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Lisbon\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Europe/Ljubljana\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/London\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "Europe/Luxembourg\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Madrid\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Malta\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Mariehamn\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Minsk\0" "<+03>-3\0"
    "Europe/Monaco\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Moscow\0" "MSK-3\0"
    "Europe/Nicosia\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Oslo\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Paris\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Podgorica\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Prague\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Riga\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Rome\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Samara\0" "<+04>-4\0"
    "Europe/San_Marino\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Sarajevo\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Saratov\0" "<+04>-4\0"
    "Europe/Simferopol\0" "MSK-3\0"
    "Europe/Skopje\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Sofia\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Stockholm\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Tallinn\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Tirane\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Tiraspol\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Ulyanovsk\0" "<+04>-4\0"
    "Europe/Uzhgorod\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Vaduz\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Vatican\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Vienna\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Vilnius\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Volgograd\0" "MSK-3\0"
    "Europe/Warsaw\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Zagreb\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Europe/Zaporozhye\0" "EET-2EEST,M3.5.0/3,M10.5.0/4\0"
    "Europe/Zurich\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Factory\0" "<-00>0\0"
    "GB\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "GB-Eire\0" "GMT0BST,M3.5.0/1,M10.5.0\0"
    "GMT\0" "GMT0\0"
    "GMT+0\0" "GMT0\0"
    "GMT-0\0" "GMT0\0"
    "GMT0\0" "GMT0\0"
    "Greenwich\0" "GMT0\0"
    "HST\0" "HST10\0"
    "Hongkong\0" "HKT-8\0"
    "Iceland\0" "GMT0\0"
    "Indian/Antananarivo\0" "EAT-3\0"
    "Indian/Chagos\0" "<+06>-6\0"
    "Indian/Christmas\0" "<+07>-7\0"
    "Indian/Cocos\0" "<+0630>-6:30\0"
    "Indian/Comoro\0" "EAT-3\0"
    "Indian/Kerguelen\0" "<+05>-5\0"
    "Indian/Mahe\0" "<+04>-4\0"
    "Indian/Maldives\0" "<+05>-5\0"
    "Indian/Mauritius\0" "<+04>-4\0"
    "Indian/Mayotte\0" "EAT-3\0"
    "Indian/Reunion\0" "<+04>-4\0"
    "Iran\0" "<+0330>-3:30\0"
    "Israel\0" "IST-2IDT,M3.4.4/26,M10.5.0\0"
    "Jamaica\0" "EST5\0"
    "Japan\0" "JST-9\0"
    "Kwajalein\0" "<+12>-12\0"
    "Libya\0" "EET-2\0"
    "MET\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "MST\0" "MST7\0"
    "MST7MDT\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "Mexico/BajaNorte\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "Mexico/BajaSur\0" "MST7\0"
    "Mexico/General\0" "CST6\0"
    "NZ\0" "NZST-12NZDT,M9.5.0,M4.1.0/3\0"
    "NZ-CHAT\0" "<+1245>-12:45<+1345>,M9.5.0/2:45,M4.1.0/3:45\0"
    "Navajo\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "PRC\0" "CST-8\0"
    "PST8PDT\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "Pacific/Apia\0" "<+13>-13\0"
    "Pacific/Auckland\0" "NZST-12NZDT,M9.5.0,M4.1.0/3\0"
    "Pacific/Bougainville\0" "<+11>-11\0"
    "Pacific/Chatham\0" "<+1245>-12:45<+1345>,M9.5.0/2:45,M4.1.0/3:45\0"
    "Pacific/Chuuk\0" "<+10>-10\0"
    "Pacific/Easter\0" "<-06>6<-05>,M9.1.6/22,M4.1.6/22\0"
    "Pacific/Efate\0" "<+11>-11\0"
    "Pacific/Enderbury\0" "<+13>-13\0"
    "Pacific/Fakaofo\0" "<+13>-13\0"
    "Pacific/Fiji\0" "<+12>-12\0"
    "Pacific/Funafuti\0" "<+12>-12\0"
    "Pacific/Galapagos\0" "<-06>6\0"
    "Pacific/Gambier\0" "<-09>9\0"
    "Pacific/Guadalcanal\0" "<+11>-11\0"
    "Pacific/Guam\0" "ChST-10\0"
    "Pacific/Honolulu\0" "HST10\0"
    "Pacific/Johnston\0" "HST10\0"
    "Pacific/Kanton\0" "<+13>-13\0"
    "Pacific/Kiritimati\0" "<+14>-14\0"
    "Pacific/Kosrae\0" "<+11>-11\0"
    "Pacific/Kwajalein\0" "<+12>-12\0"
    "Pacific/Majuro\0" "<+12>-12\0"
    "Pacific/Marquesas\0" "<-0930>9:30\0"
    "Pacific/Midway\0" "SST11\0"
    "Pacific/Nauru\0" "<+12>-12\0"
    "Pacific/Niue\0" "<-11>11\0"
    "Pacific/Norfolk\0" "<+11>-11<+12>,M10.1.0,M4.1.0/3\0"
    "Pacific/Noumea\0" "<+11>-11\0"
    "Pacific/Pago_Pago\0" "SST11\0"
    "Pacific/Palau\0" "<+09>-9\0"
    "Pacific/Pitcairn\0" "<-08>8\0"
    "Pacific/Pohnpei\0" "<+11>-11\0"
    "Pacific/Ponape\0" "<+11>-11\0"
    "Pacific/Port_Moresby\0" "<+10>-10\0"
    "Pacific/Rarotonga\0" "<-10>10\0"
    "Pacific/Saipan\0" "ChST-10\0"
    "Pacific/Samoa\0" "SST11\0"
    "Pacific/Tahiti\0" "<-10>10\0"
    "Pacific/Tarawa\0" "<+12>-12\0"
    "Pacific/Tongatapu\0" "<+13>-13\0"
    "Pacific/Truk\0" "<+10>-10\0"
    "Pacific/Wake\0" "<+12>-12\0"
    "Pacific/Wallis\0" "<+12>-12\0"
    "Pacific/Yap\0" "<+10>-10\0"
    "Poland\0" "CET-1CEST,M3.5.0,M10.5.0/3\0"
    "Portugal\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "ROC\0" "CST-8\0"
    "ROK\0" "KST-9\0"
    "Singapore\0" "<+08>-8\0"
    "Turkey\0" "<+03>-3\0"
    "UCT\0" "UTC0\0"
    "US/Alaska\0" "AKST9AKDT,M3.2.0,M11.1.0\0"
    "US/Aleutian\0" "HST10HDT,M3.2.0,M11.1.0\0"
    "US/Arizona\0" "MST7\0"
    "US/Central\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "US/East-Indiana\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "US/Eastern\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "US/Hawaii\0" "HST10\0"
    "US/Indiana-Starke\0" "CST6CDT,M3.2.0,M11.1.0\0"
    "US/Michigan\0" "EST5EDT,M3.2.0,M11.1.0\0"
    "US/Mountain\0" "MST7MDT,M3.2.0,M11.1.0\0"
    "US/Pacific\0" "PST8PDT,M3.2.0,M11.1.0\0"
    "US/Samoa\0" "SST11\0"
    "UTC\0" "UTC0\0"
    "Universal\0" "UTC0\0"
    "W-SU\0" "MSK-3\0"
    "WET\0" "WET0WEST,M3.5.0/1,M10.5.0\0"
    "Zulu\0" "UTC0\0"
;
    if (!id) return nullptr;
    static char rule[128];
    const char *entry = ZONES;
    while (readByte(entry)) {
        const char *value = id;
        bool match = true;
        for (char c; (c = readByte(entry++)) != 0;) {
            if (*value != c) match = false;
            if (*value) ++value;
        }
        match = match && !*value;
        size_t length = 0;
        for (char c; (c = readByte(entry++)) != 0;) {
            if (match && length < sizeof(rule) - 1) rule[length++] = c;
        }
        if (match) { rule[length] = 0; return rule; }
    }
    return nullptr;
}
}
namespace alarmTimeZones {
inline bool offsetAt(const char *id, int64_t now, int32_t &offset) {
    struct Transition { uint32_t at; int32_t offset; };
    if (strcmp(id, "Africa/Casablanca") == 0 && now >= 1767225600LL && now < 1789866000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,3600},{1771120800U,0},{1774144800U,3600},{1789866000U,0}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "Africa/El_Aaiun") == 0 && now >= 1767225600LL && now < 1789866000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,3600},{1771120800U,0},{1774144800U,3600},{1789866000U,0}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "America/Edmonton") == 0 && now >= 1767225600LL && now < 1793520000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-25200},{1772960400U,-21600},{1793520000U,-21600}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "America/Inuvik") == 0 && now >= 1767225600LL && now < 1793520000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-25200},{1772960400U,-21600},{1793520000U,-21600}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "America/Vancouver") == 0 && now >= 1767225600LL && now < 1793523600LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-28800},{1772964000U,-25200},{1793523600U,-25200}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "America/Yellowknife") == 0 && now >= 1767225600LL && now < 1793520000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-25200},{1772960400U,-21600},{1793520000U,-21600}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "Asia/Gaza") == 0 && now >= 1767225600LL && now < 3686425200LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,7200},{1774656000U,10800},{1792796400U,7200},{1806105600U,10800},{1824850800U,7200},{1837555200U,10800},{1856300400U,7200},{1869004800U,10800},{1887750000U,7200},{1901059200U,10800},{1919199600U,7200},{1932508800U,10800},{1950649200U,7200},{1963958400U,10800},{1982703600U,7200},{1995408000U,10800},{2014153200U,7200},{2026857600U,10800},{2045602800U,7200},{2058307200U,10800},{2077052400U,7200},{2090361600U,10800},{2107897200U,7200},{2121811200U,10800},{2138742000U,7200},{2153260800U,10800},{2168982000U,7200},{2184710400U,10800},{2199826800U,7200},{2216160000U,10800},{2230066800U,7200},{2234304000U,10800},{2234905200U,7200},{2248214400U,10800},{2260911600U,7200},{2264544000U,10800},{2266354800U,7200},{2279664000U,10800},{2291756400U,7200},{2295388800U,10800},{2297804400U,7200},{2311113600U,10800},{2321996400U,7200},{2326233600U,10800},{2329254000U,7200},{2342563200U,10800},{2352841200U,7200},{2356473600U,10800},{2361308400U,7200},{2374012800U,10800},{2383686000U,7200},{2387318400U,10800},{2392758000U,7200},{2405462400U,10800},{2413926000U,7200},{2418163200U,10800},{2424207600U,7200},{2437516800U,10800},{2444770800U,7200},{2448403200U,10800},{2455657200U,7200},{2468966400U,10800},{2475010800U,7200},{2479248000U,10800},{2487106800U,7200},{2500416000U,10800},{2505855600U,7200},{2509488000U,10800},{2519161200U,7200},{2531865600U,10800},{2536700400U,7200},{2540332800U,10800},{2550610800U,7200},{2563315200U,10800},{2566940400U,7200},{2571177600U,10800},{2582060400U,7200},{2595369600U,10800},{2597785200U,7200},{2601417600U,10800},{2613510000U,7200},{2626819200U,10800},{2628025200U,7200},{2632262400U,10800},{2644959600U,7200},{2658268800U,10800},{2658870000U,7200},{2663107200U,10800},{2676409200U,7200},{2693347200U,10800},{2708463600U,7200},{2724192000U,10800},{2739913200U,7200},{2754432000U,10800},{2771362800U,7200},{2785276800U,10800},{2802812400U,7200},{2816121600U,10800},{2834262000U,7200},{2847571200U,10800},{2866316400U,7200},{2879020800U,10800},{2897766000U,7200},{2910470400U,10800},{2929215600U,7200},{2941920000U,10800},{2960665200U,7200},{2973974400U,10800},{2992114800U,7200},{3005424000U,10800},{3023564400U,7200},{3036873600U,10800},{3055618800U,7200},{3068323200U,10800},{3087068400U,7200},{3099772800U,10800},{3117913200U,7200},{3131827200U,10800},{3148758000U,7200},{3163276800U,10800},{3179602800U,7200},{3194726400U,10800},{3209842800U,7200},{3226176000U,10800},{3240687600U,7200},{3244320000U,10800},{3244921200U,7200},{3257625600U,10800},{3271532400U,7200},{3275164800U,10800},{3276370800U,7200},{3289075200U,10800},{3301772400U,7200},{3306009600U,10800},{3307820400U,7200},{3321129600U,10800},{3332617200U,7200},{3336249600U,10800},{3339270000U,7200},{3352579200U,10800},{3362857200U,7200},{3367094400U,10800},{3370719600U,7200},{3384028800U,10800},{3393702000U,7200},{3397939200U,10800},{3402774000U,7200},{3415478400U,10800},{3424546800U,7200},{3428179200U,10800},{3434223600U,7200},{3446928000U,10800},{3454786800U,7200},{3459024000U,10800},{3465673200U,7200},{3478982400U,10800},{3485631600U,7200},{3489264000U,10800},{3497122800U,7200},{3510432000U,10800},{3516476400U,7200},{3520108800U,10800},{3528572400U,7200},{3541881600U,10800},{3546716400U,7200},{3550953600U,10800},{3560022000U,7200},{3573331200U,10800},{3577561200U,7200},{3581193600U,10800},{3592076400U,7200},{3604780800U,10800},{3607801200U,7200},{3612038400U,10800},{3623526000U,7200},{3636230400U,10800},{3638646000U,7200},{3642883200U,10800},{3654975600U,7200},{3668284800U,10800},{3669490800U,7200},{3673123200U,10800},{3686425200U,7200}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "Asia/Hebron") == 0 && now >= 1767225600LL && now < 3686425200LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,7200},{1774656000U,10800},{1792796400U,7200},{1806105600U,10800},{1824850800U,7200},{1837555200U,10800},{1856300400U,7200},{1869004800U,10800},{1887750000U,7200},{1901059200U,10800},{1919199600U,7200},{1932508800U,10800},{1950649200U,7200},{1963958400U,10800},{1982703600U,7200},{1995408000U,10800},{2014153200U,7200},{2026857600U,10800},{2045602800U,7200},{2058307200U,10800},{2077052400U,7200},{2090361600U,10800},{2107897200U,7200},{2121811200U,10800},{2138742000U,7200},{2153260800U,10800},{2168982000U,7200},{2184710400U,10800},{2199826800U,7200},{2216160000U,10800},{2230066800U,7200},{2234304000U,10800},{2234905200U,7200},{2248214400U,10800},{2260911600U,7200},{2264544000U,10800},{2266354800U,7200},{2279664000U,10800},{2291756400U,7200},{2295388800U,10800},{2297804400U,7200},{2311113600U,10800},{2321996400U,7200},{2326233600U,10800},{2329254000U,7200},{2342563200U,10800},{2352841200U,7200},{2356473600U,10800},{2361308400U,7200},{2374012800U,10800},{2383686000U,7200},{2387318400U,10800},{2392758000U,7200},{2405462400U,10800},{2413926000U,7200},{2418163200U,10800},{2424207600U,7200},{2437516800U,10800},{2444770800U,7200},{2448403200U,10800},{2455657200U,7200},{2468966400U,10800},{2475010800U,7200},{2479248000U,10800},{2487106800U,7200},{2500416000U,10800},{2505855600U,7200},{2509488000U,10800},{2519161200U,7200},{2531865600U,10800},{2536700400U,7200},{2540332800U,10800},{2550610800U,7200},{2563315200U,10800},{2566940400U,7200},{2571177600U,10800},{2582060400U,7200},{2595369600U,10800},{2597785200U,7200},{2601417600U,10800},{2613510000U,7200},{2626819200U,10800},{2628025200U,7200},{2632262400U,10800},{2644959600U,7200},{2658268800U,10800},{2658870000U,7200},{2663107200U,10800},{2676409200U,7200},{2693347200U,10800},{2708463600U,7200},{2724192000U,10800},{2739913200U,7200},{2754432000U,10800},{2771362800U,7200},{2785276800U,10800},{2802812400U,7200},{2816121600U,10800},{2834262000U,7200},{2847571200U,10800},{2866316400U,7200},{2879020800U,10800},{2897766000U,7200},{2910470400U,10800},{2929215600U,7200},{2941920000U,10800},{2960665200U,7200},{2973974400U,10800},{2992114800U,7200},{3005424000U,10800},{3023564400U,7200},{3036873600U,10800},{3055618800U,7200},{3068323200U,10800},{3087068400U,7200},{3099772800U,10800},{3117913200U,7200},{3131827200U,10800},{3148758000U,7200},{3163276800U,10800},{3179602800U,7200},{3194726400U,10800},{3209842800U,7200},{3226176000U,10800},{3240687600U,7200},{3244320000U,10800},{3244921200U,7200},{3257625600U,10800},{3271532400U,7200},{3275164800U,10800},{3276370800U,7200},{3289075200U,10800},{3301772400U,7200},{3306009600U,10800},{3307820400U,7200},{3321129600U,10800},{3332617200U,7200},{3336249600U,10800},{3339270000U,7200},{3352579200U,10800},{3362857200U,7200},{3367094400U,10800},{3370719600U,7200},{3384028800U,10800},{3393702000U,7200},{3397939200U,10800},{3402774000U,7200},{3415478400U,10800},{3424546800U,7200},{3428179200U,10800},{3434223600U,7200},{3446928000U,10800},{3454786800U,7200},{3459024000U,10800},{3465673200U,7200},{3478982400U,10800},{3485631600U,7200},{3489264000U,10800},{3497122800U,7200},{3510432000U,10800},{3516476400U,7200},{3520108800U,10800},{3528572400U,7200},{3541881600U,10800},{3546716400U,7200},{3550953600U,10800},{3560022000U,7200},{3573331200U,10800},{3577561200U,7200},{3581193600U,10800},{3592076400U,7200},{3604780800U,10800},{3607801200U,7200},{3612038400U,10800},{3623526000U,7200},{3636230400U,10800},{3638646000U,7200},{3642883200U,10800},{3654975600U,7200},{3668284800U,10800},{3669490800U,7200},{3673123200U,10800},{3686425200U,7200}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "Canada/Mountain") == 0 && now >= 1767225600LL && now < 1793520000LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-25200},{1772960400U,-21600},{1793520000U,-21600}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    if (strcmp(id, "Canada/Pacific") == 0 && now >= 1767225600LL && now < 1793523600LL) {
        static const Transition changes[] ALARM_TZ_FLASH = {{1767225600U,-28800},{1772964000U,-25200},{1793523600U,-25200}};
        for (int i = sizeof(changes) / sizeof(changes[0]) - 1; i >= 0; --i) {
            Transition entry;
#ifdef ARDUINO
            memcpy_P(&entry, &changes[i], sizeof(entry));
#else
            entry = changes[i];
#endif
            if (now >= entry.at) { offset = entry.offset; return true; }
        }
    }
    return false;
}
inline const char *ruleAt(const char *id, int64_t now) {
    const char *rule = ruleFor(id);
    if (!rule) return nullptr;
    int32_t offset;
    if (!offsetAt(id, now, offset)) return rule;
    static char fixed[32];
    const unsigned absolute = offset < 0 ? -offset : offset;
    snprintf(fixed, sizeof(fixed), "UTC%s%u:%02u:%02u", offset < 0 ? "+" : "-", absolute / 3600, (absolute % 3600) / 60, absolute % 60);
    return fixed;
}
}
#undef ALARM_TZ_FLASH
