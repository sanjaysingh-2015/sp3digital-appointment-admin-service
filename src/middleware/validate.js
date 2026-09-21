const Joi = require('joi');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      convert: true,
      stripUnknown: true,
    });

    if (error) return next(error);
    req[source] = value;

    return next();
  };
}

const id = Joi.number().integer().positive().required();

module.exports = { Joi, validate, id };
