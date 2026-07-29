-- Core-key parity for CellarTracker catalogue matching.
--
-- The same algorithm exists twice: here for the whole-catalogue tier, and in
-- apps/web/src/lib/cellar/cellartrackerMatching.ts for the Algolia shortlist.
-- The two never compare with each other at runtime, so drift does not corrupt a
-- match, but it does make the two tiers disagree about the same wine. The
-- expected strings below are the values the TypeScript implementation produces
-- for the same inputs, and both suites assert them independently.
--
-- Source rows are real CellarTracker-shaped identities; catalogue rows are real
-- prod_product records captured 29 July 2026.

BEGIN;

SELECT plan(37);

-- Normalisation.

SELECT is(private.ct_wine_core_key('', NULL), '', 'empty input yields an empty key');
SELECT is(private.ct_wine_core_key(NULL, NULL), '', 'null input yields an empty key');
SELECT is(private.ct_wine_core_key(' , - , ', NULL), '', 'punctuation-only input yields an empty key');
SELECT is(private.ct_wine_core_key('2018 Barrua 1996', NULL), 'barrua',
    'four-digit vintage tokens are dropped wherever they appear');
SELECT is(private.ct_wine_core_key('Château Léoville  Barton, Léoville', NULL), 'barton chateau leoville',
    'accents are folded and repeated tokens collapse');
SELECT is(private.ct_wine_core_key('CHÂTEAU MARGAUX', NULL), 'chateau margaux',
    'accented capitals fold, because lower() runs before translate()');
SELECT is(private.ct_wine_core_key('Domaine de la Romanée-Conti', NULL), 'conti domaine romanee',
    'articles are dropped but producer words are kept');

-- CellarTracker source identities.

SELECT is(private.ct_wine_core_key('Agricola Punica Barrua', 'Agricola Punica'),
    'agricola barrua punica', 'ct: Barrua');
SELECT is(private.ct_wine_core_key('Chateau Leoville Barton', 'Chateau Leoville Barton'),
    'barton chateau leoville', 'ct: Leoville Barton');
SELECT is(private.ct_wine_core_key('Penfolds Grange', 'Penfolds'),
    'grange penfolds', 'ct: Grange');
SELECT is(private.ct_wine_core_key('Domaine Armand Rousseau Pere et Fils Gevrey-Chambertin Clos St. Jacques', 'Domaine Armand Rousseau Pere et Fils'),
    'armand chambertin clos domaine fils gevrey jacques pere rousseau st', 'ct: Clos St Jacques');
SELECT is(private.ct_wine_core_key('Hamilton Russell Vineyards Chardonnay', 'Hamilton Russell Vineyards'),
    'chardonnay hamilton russell vineyards', 'ct: Hamilton Russell Chardonnay');
SELECT is(private.ct_wine_core_key('Chateau d''Esclans Whispering Angel Rose', 'Chateau d''Esclans'),
    'angel chateau d esclans rose whispering', 'ct: Whispering Angel');
SELECT is(private.ct_wine_core_key('Bibi Graetz Testamatta Bianco', 'Bibi Graetz'),
    'bianco bibi graetz testamatta', 'ct: Testamatta Bianco');
SELECT is(private.ct_wine_core_key('Grosset Polish Hill Riesling', 'Grosset'),
    'grosset hill polish riesling', 'ct: Polish Hill');
SELECT is(private.ct_wine_core_key('Domaine de la Romanee-Conti Echezeaux', 'Domaine de la Romanee-Conti'),
    'conti domaine echezeaux romanee', 'ct: DRC Echezeaux');
SELECT is(private.ct_wine_core_key('Tenuta San Guido Sassicaia Bolgheri', 'Tenuta San Guido'),
    'bolgheri guido san sassicaia tenuta', 'ct: Sassicaia');
SELECT is(private.ct_wine_core_key('Chateau Margaux', 'Chateau Margaux'),
    'chateau margaux', 'ct: Chateau Margaux');
SELECT is(private.ct_wine_core_key('Chateau Pichon Longueville Comtesse de Lalande', 'Chateau Pichon Longueville Comtesse de Lalande'),
    'chateau comtesse lalande longueville pichon', 'ct: Pichon Lalande');
SELECT is(private.ct_wine_core_key('Domaine Leflaive Puligny-Montrachet 1er Cru Les Pucelles', 'Domaine Leflaive'),
    '1er cru domaine leflaive montrachet pucelles puligny', 'ct: Les Pucelles');
SELECT is(private.ct_wine_core_key('E. Guigal Cote-Rotie La Mouline', 'E. Guigal'),
    'cote guigal mouline rotie', 'ct: La Mouline, single-letter initial dropped as a stopword');

-- BBR catalogue identities.

SELECT is(private.bbr_wine_core_key(
    '2018 Barrua, Isola dei Nuraghi, Punica, Sardinia, Italy', 'Agricola Punica', 'Italy', 'Sardegna', 'Isola dei Nuraghi'),
    'agricola barrua punica sardinia',
    'bbr: geography the record spells differently to its own region survives');
SELECT is(private.bbr_wine_core_key(
    '2018 Château Léoville Barton, St Julien, Bordeaux', 'Château Léoville Barton', 'France', 'Bordeaux', 'Médoc'),
    'barton chateau julien leoville st',
    'bbr: a subregion the fields do not name is kept');
SELECT is(private.bbr_wine_core_key(
    '2013 Penfolds, Grange, Bin 95, Australia', 'Penfolds', 'Australia', 'South Australia', 'Barossa'),
    '95 bin grange penfolds', 'bbr: Grange');
SELECT is(private.bbr_wine_core_key(
    '2017 Gevrey-Chambertin, Clos St Jacques, 1er Cru, Domaine Armand Rousseau, Burgundy', 'Domaine Armand Rousseau', 'France', 'Burgundy', 'Côte de Nuits'),
    '1er armand chambertin clos cru domaine gevrey jacques rousseau st', 'bbr: Clos St Jacques');
SELECT is(private.bbr_wine_core_key(
    '2025 Hamilton Russell Vineyards, Chardonnay, Hemel-en-Aarde Valley, South Africa', 'Hamilton Russell Vineyards', 'South Africa', 'Cape South Coast', 'Walker Bay'),
    'aarde chardonnay en hamilton hemel russell valley vineyards', 'bbr: Hamilton Russell Chardonnay');
SELECT is(private.bbr_wine_core_key(
    '2025 Château d''Esclans, Whispering Angel Rosé, Côtes de Provence', 'Château d''Esclans', 'France', 'Provence', 'Côtes de Provence'),
    'angel chateau d esclans rose whispering', 'bbr: Whispering Angel');
SELECT is(private.bbr_wine_core_key(
    '2025 Testamatta Bianco, Bibi Graetz, Tuscany, Italy', 'Bibi Graetz', 'Italy', 'Tuscany', NULL),
    'bianco bibi graetz testamatta', 'bbr: a null subregion is tolerated');
SELECT is(private.bbr_wine_core_key(
    '2025 Grosset, Polish Hill Riesling, Clare Valley, Australia', 'Grosset', 'Australia', 'South Australia', 'Clare Valley'),
    'grosset hill polish riesling', 'bbr: Polish Hill');
SELECT is(private.bbr_wine_core_key(
    '2017 Richebourg, Grand Cru, Domaine de la Romanée-Conti, Burgundy', 'Domaine de la Romanée-Conti (DRC)', 'France', 'Burgundy', 'Côte de Nuits'),
    'conti cru domaine drc grand richebourg romanee', 'bbr: DRC Richebourg');
SELECT is(private.bbr_wine_core_key(
    '2018 Sassicaia, Tenuta San Guido, Bolgheri Sassicaia, Tuscany, Italy', 'Sassicaia', 'Italy', 'Tuscany', 'Bolgheri Sassicaia'),
    'guido san sassicaia tenuta', 'bbr: Sassicaia');
SELECT is(private.bbr_wine_core_key(
    '2015 Château Margaux, Margaux, Bordeaux', 'Château Margaux', 'France', 'Bordeaux', 'Médoc'),
    'chateau margaux',
    'bbr: the first segment is never dropped, so an eponymous appellation survives');
SELECT is(private.bbr_wine_core_key(
    '2016 Château Pichon Longueville Comtesse de Lalande, Pauillac, Bordeaux', 'Château Pichon-Longueville Lalande', 'France', 'Bordeaux', 'Médoc'),
    'chateau comtesse lalande longueville pauillac pichon', 'bbr: Pichon Lalande');
SELECT is(private.bbr_wine_core_key(
    '2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Domaine Leflaive, Burgundy', 'Domaine Leflaive', 'France', 'Burgundy', 'Côte de Beaune'),
    '1er cru domaine leflaive montrachet pucelles puligny', 'bbr: Les Pucelles');
SELECT is(private.bbr_wine_core_key(
    '2018 Côte-Rôtie, La Mouline, E. Guigal, Rhône', 'Maison Guigal', 'France', 'Rhône ', 'Northern Rhône'),
    'cote guigal maison mouline rotie',
    'bbr: a producer field the name does not repeat is folded in');

-- Tier one. These five pairs are what the whole-catalogue join now links; the
-- inherited full-string comparison matched none of them.

SELECT is(
    (SELECT count(*) FROM (VALUES
        ('Chateau d''Esclans Whispering Angel Rose', 'Chateau d''Esclans',
         '2025 Château d''Esclans, Whispering Angel Rosé, Côtes de Provence', 'Château d''Esclans', 'France', 'Provence', 'Côtes de Provence'),
        ('Bibi Graetz Testamatta Bianco', 'Bibi Graetz',
         '2025 Testamatta Bianco, Bibi Graetz, Tuscany, Italy', 'Bibi Graetz', 'Italy', 'Tuscany', NULL),
        ('Grosset Polish Hill Riesling', 'Grosset',
         '2025 Grosset, Polish Hill Riesling, Clare Valley, Australia', 'Grosset', 'Australia', 'South Australia', 'Clare Valley'),
        ('Chateau Margaux', 'Chateau Margaux',
         '2015 Château Margaux, Margaux, Bordeaux', 'Château Margaux', 'France', 'Bordeaux', 'Médoc'),
        ('Domaine Leflaive Puligny-Montrachet 1er Cru Les Pucelles', 'Domaine Leflaive',
         '2018 Puligny-Montrachet, Les Pucelles, 1er Cru, Domaine Leflaive, Burgundy', 'Domaine Leflaive', 'France', 'Burgundy', 'Côte de Beaune')
    ) AS pair(wine, ct_producer, name, producer, country, region, subregion)
    WHERE private.ct_wine_core_key(pair.wine, pair.ct_producer)
        = private.bbr_wine_core_key(pair.name, pair.producer, pair.country, pair.region, pair.subregion)),
    5::BIGINT,
    'tier one: all five representative pairs resolve to an identical core key');

SELECT isnt(
    private.ct_wine_core_key('Domaine de la Romanee-Conti Echezeaux', 'Domaine de la Romanee-Conti'),
    private.bbr_wine_core_key('2017 Richebourg, Grand Cru, Domaine de la Romanée-Conti, Burgundy',
        'Domaine de la Romanée-Conti (DRC)', 'France', 'Burgundy', 'Côte de Nuits'),
    'tier one: the right producer with the wrong wine does not become an exact key');

SELECT * FROM finish();
ROLLBACK;
