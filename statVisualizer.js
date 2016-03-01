ymaps.modules.define('StatVisualizer', [
    'regions',
    'util.defineClass', 'util.extend',
    'collection.Item',
    'ObjectManager',
    'data.Manager',
    'vow',
    'templateLayoutFactory'
], function (provide,
        regions,
        defineClass, extend,
        CollectionItem,
        ObjectManager,
        DataManager,
        vow,
        templateLayoutFactory) {

        /**
         * Creates a statistical data visualizer. This module
         * allows displaying infographics in a form of regions
         * on map, each colored according to some statistical
         * value.
         * @class StatVisualizer
         * @param {Object} parameters Parameters.
         * @param {String|String[]} parameters.regions ISO codes of regions
         * to display. The module uses data defined in
         * Yandex Maps Regions module, available values are: 'RU', 'UA',
         * 'BY', 'KZ', 'TR' for corresponding countries, and '001' for entire
         * world.
         * @param {Object} parameters.data Statistical data to display.
         * @param {String} parameters.data.source Raw source data in a form
         * of CSV string. First line indicates columns' names, other lines — values.
         * @param {Object} parameters.mapping Mapping options
         * @param {String} parameters.mapping.id Name of a column which contains
         * an ISO code of region
         * @param {String} parameters.mapping.target Name of a column which contains
         * a statistical value to display.
         * @param {Object} parameters.colors Coloring parameters.
         * @param {Number} parameters.colors.minValue Minimal allowed statistical value.
         * @param {Number} parameters.colors.maxValue Maximal allowed statistical value.
         * @param {String} [parameters.colors.low = '00ff00'] Color corresponding to minimal
         * value, in a RGB(A) form.
         * @param {String} [parameters.colors.high = 'ff0000'] Color corresponding to maximal
         * value, in a RGB(A) form.
         * @param {Boolean} [parameters.colors.discrete = false] true — there is a predefined
         * number of color levels; false otherwise.
         * @param {Number[]} [parameters.colors.grades] If `parameters.colors.discrete` option
         * is set to true — an array of statistical values representing each level color.
         * @param {Object} [parameters.balloon] Objects' balloon parameters.
         * @param {String} [parameters.balloon.template] Balloon template.
         * @param {Object} [parameters.hint] Objects' hint parameters.
         * @param {String} [parameters.hint.template] Hint template.
         */
    var StatVisualizer = function (parameters) {
            this.regions = parameters.regions;
            this.colors = this.prepareColors(parameters.colors || {});
            this.data = this.prepareData(parameters.data);

            StatVisualizer.superclass.constructor.call(this, parameters.options);
            this.objectManager = new ObjectManager();
            this.objectManager.objects.options.set({
                fillColor: '#a0a0a080',
                strokeColor: '#808080d0',
                opacity: 0.8
            });

            if (parameters.hint && parameters.hint.template) {
                this.objectManager.objects.options.set({
                    hintContentLayout: templateLayoutFactory.createClass(parameters.hint.template)
                })
            }
            if (parameters.balloon && parameters.balloon.template) {
                this.objectManager.objects.options.set({
                    balloonContentLayout: templateLayoutFactory.createClass(parameters.balloon.template)
                })
            }

            this.objectManager.objects.events.add(['mouseenter', 'mouseleave'], function (e) {
                var opacity = e.get('type') == 'mouseenter' ? 1 : 0.8;
                this.setRegionOptions(e.get('objectId'), {
                    opacity: opacity
                });
            }, this);
        };
    
    defineClass(StatVisualizer, CollectionItem, {
        onAddToMap: function () {
            this.getMap().geoObjects.add(this.objectManager);
            this.render();
        },
        
        onRemoveFromMap: function () {
            this.getMap().geoObjects.remove(this.objectManager);
        },
        
        render: function () {
            var regionCodes = this.regions,
                data = this.data,
                promises = [];
            
            regionCodes = [].concat(regionCodes);
            for (var i = 0, l = regionCodes.length; i < l; i++) {
                promises.push(regions.load(regionCodes[i]));
            }
            
            vow.all(promises).done(this.onRegionsReady, this);
        },
        
        onRegionsReady: function (regions) {
            var features = [];
            
            for (var i = 0, l = regions.length; i < l; i++) {
                regions[i].geoObjects.each(function (geoObject) {
                    var feature = this.prepareFeature(geoObject);
                    if (feature) {
                        features.push(feature);
                    }
                }, this);
            }
            this.objectManager.add(features);
        },
        
        prepareData: function (rawData) {
            var data = {};
                lines = rawData.source.split('\n'),
                names = lines[0].split(','),
                idIndex = names.indexOf(rawData.mapping.id),
                targetIndex = names.indexOf(rawData.mapping.target);
                    
            if (idIndex == -1){
                throw new Error('Id column not found');
            }
            
            if (targetIndex == -1) {
                throw new Error('Target column not found');
            }
            
            for (var i = 1, l = lines.length; i < l; i++) {
                if (lines[i]) {
                    var parts = lines[i].split(',');

                    if (parts[idIndex]) {
                        var value = Number(parts[targetIndex]),
                            entry = data[parts[idIndex]] = {
                                value: value,
                                columns: {}
                            };
                        for (var j = 0, n = names.length; j < n; j++) {
                            entry.columns[names[j]] = parts[j];
                        }
                    } else {
                        console.log('Line "' + lines[i] + '" has no `' + rawData.mapping.id + '` entry');
                    }
                }
            }

            return data;
        },

        prepareColors: function (colorOptions) {
            var colors = {
                    discrete: colorOptions.discrete || false,
                    low: this.parseRgbaColor(colorOptions.low || '#0f0'),
                    high: this.parseRgbaColor(colorOptions.high || '#f00'),
                    grades: []
                };

            if (colorOptions.discrete) {
                var grades = colorOptions.grades.slice().sort(function (a, b) { return a - b; }),
                    range = grades[grades.length - 1] - grades[0];

                for (var i = 0, l = grades.length; i < l; i++) {
                    var grade = grades[i];

                    colors.grades.push({
                        value: grade,
                        color: this.getInterimColor(colors.low, colors.high, (grade - grades[0]) / range)
                    });
                }
            } else {
                colors.grades = [
                    { value: colorOptions.minValue, color: colors.low },
                    { value: colorOptions.maxValue, color: colors.high },
                ];
            }

            return colors;
        },

        parseRgbaColor: function (color) {
            if (color.indexOf('#') == 0) {
                color = color.substring(1);
            }
            var parts = [],
                chunkSize;
            if (color.length == 3 || color.length == 4) {
                chunkSize = 1;
            } else if (color.length == 6 || color.length == 8) {
                chunkSize = 2;
            } else {
                throw new Error('Wrong color format: ' + color);
            }

            for (var i = 0; i < 4; i++) {
                var part = '0';
                if ((i + 1) * chunkSize <= color.length) {
                    part = color.substring(i * chunkSize, (i + 1) * chunkSize);
                    if (chunkSize == 1) {
                        part = part + part;
                    }
                } else {
                    part = 'ff';
                }
                parts.push(parseInt(part, 16));
            }

            return parts;
        },

        serializeRgbaColor: function (color) {
            var parts = [];
            for (var i = 0; i < color.length; i++) {
                var part = color[i].toString(16);
                while (part.length < 2) {
                    part = '0' + part;
                }
                parts.push(part);
            }
            return '#' + parts.join('');
        },

        getInterimColor: function (color1, color2, portion) {
            return [
                Math.floor(color1[0] + portion * (color2[0] - color1[0])),
                Math.floor(color1[1] + portion * (color2[1] - color1[1])),
                Math.floor(color1[2] + portion * (color2[2] - color1[2])),
                Math.floor(color1[3] + portion * (color2[3] - color1[3]))
            ];
        },

        prepareFeature: function (geoObject) {
            var properties = geoObject.properties.getAll(),
                regionId = properties.properties.iso3166.replace(/-/g, '_'),
                data = this.data[regionId],
                feature = {
                    type: "Feature",
                    id: Math.random().toString(),
                    geometry: {
                        type: geoObject.geometry.getType(),
                        coordinates: geoObject.geometry.getCoordinates()
                    },
                    properties: extend({}, properties, {
                        regionId: regionId
                    }),
                    options: {}
                };

            if (data) {
                extend(feature.properties, {
                    value: data.value,
                    fields: extend({}, data.columns)
                });
                feature.options.fillColor = this.serializeRgbaColor(this.getFillColor(data.value));
            }

            return feature;
        },

        getFillColor: function (value) {
            var colors = this.colors.grades,
                discrete = this.colors.discrete;

            for (var i = 0, l = colors.length; i < l; i++) {
                if (value <= colors[i].value) {
                    return discrete ? colors[i].color : (
                        i > 0 ? this.getInterimColor(
                            colors[i - 1].color,
                            colors[i].color,
                            (value - colors[i - 1].value) / (colors[i].value - colors[i - 1].value)
                        ) : colors[i].color
                    );
                }
            }

            return colors[colors.length - 1].color;
        },
        
        setRegionOptions: function (id, options) {
            var parentId = this.objectManager.objects.getById(id).properties.regionId;
            this.objectManager.objects.each(function (object) {
                if (object.properties.regionId == parentId) {
                    this.objectManager.objects.setObjectOptions(object.id, options);
                }
            }, this);
        }
    });
    
    provide(StatVisualizer);    
});
